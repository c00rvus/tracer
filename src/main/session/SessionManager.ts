import { randomUUID } from "node:crypto";
import { createWriteStream, WriteStream } from "node:fs";
import { copyFile, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, dialog, nativeImage } from "electron";
import log from "electron-log";
import {
  type BrowserContext,
  type CDPSession,
  type ConsoleMessage,
  type Page
} from "playwright";
import type {
  AppSettings,
  CaptureEvent,
  ConsoleEvent,
  LifecycleEvent,
  NetworkFailEvent,
  NetworkBodyPayload,
  NetworkRequestEvent,
  NetworkResponseEvent,
  SaveSessionOptions,
  SavedSessionResult,
  ScreenshotEvent,
  ScreenshotPayload,
  SessionManifest,
  SessionStatus
} from "../../shared/types";
import { normalizeAppSettings } from "../../shared/settings";
import { createBaseEvent, normalizeConsoleLevel } from "./eventFactory";
import { buildManifest, parseManifest } from "./manifest";
import {
  ensureDir,
  parseEventsNdjsonFile,
  sanitizeFileFragment,
  serializeEventLine,
  toPosixPath
} from "./utils";
import { createSessionArchive, extractSessionArchive } from "./archive";

interface PendingResponse {
  requestId: string;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  mimeType?: string;
}

const STATUS_TEMPLATE: SessionStatus = {
  state: "idle",
  sessionId: null,
  sessionFileName: null,
  createdAt: null,
  captureStartedAt: null,
  captureEndedAt: null,
  browserVersion: null,
  source: null,
  counts: {
    events: 0,
    screenshots: 0,
    networkRequests: 0
  },
  lastError: null
};

const SCHEMA_VERSION = "1.0.0";
const MAX_TEMP_AUTOSAVES = 2;
const TIMELINE_THUMBNAIL_WIDTH_PX = 240;
const TIMELINE_THUMBNAIL_QUALITY = 72;
const TRACER_MEDIA_PROTOCOL_SCHEME = "tracer-media";
const MAC_SCROLL_CAPTURE_COOLDOWN_MS = 220;
const MAC_TIMER_JPEG_QUALITY = 62;
const MAC_EVENT_JPEG_QUALITY = 72;
const WINDOWS_SCREENCAST_MAX_WIDTH = 1280;
const WINDOWS_SCREENCAST_MAX_HEIGHT = 720;
const WINDOWS_SCREENCAST_QUALITY = 80;
const WINDOWS_SCREENCAST_FRAME_WAIT_MS = 380;
const WINDOWS_SCREENCAST_FIRST_FRAME_WAIT_MS = 900;
const CURSOR_OVERLAY_INIT_SCRIPT = `
(() => {
  const globalState = globalThis;
  if (globalState.__tracerCursorOverlayInstalled) {
    return;
  }
  globalState.__tracerCursorOverlayInstalled = true;

  const overlayId = "__tracer-cursor-overlay";
  let overlay = null;
  let x = 0;
  let y = 0;
  let frame = 0;

  const ensureOverlay = () => {
    if (overlay && overlay.isConnected) {
      return overlay;
    }
    const root = document.documentElement || document.body;
    if (!root) {
      return null;
    }

    const existing = document.getElementById(overlayId);
    if (existing) {
      overlay = existing;
      return overlay;
    }

    const element = document.createElement("div");
    element.id = overlayId;
    element.setAttribute("aria-hidden", "true");
    element.style.position = "fixed";
    element.style.left = "0px";
    element.style.top = "0px";
    element.style.width = "12px";
    element.style.height = "12px";
    element.style.borderRadius = "999px";
    element.style.background = "rgba(255,255,255,0.92)";
    element.style.border = "1.5px solid rgba(20,23,30,0.95)";
    element.style.boxShadow = "0 0 0 2px rgba(38,132,255,0.25), 0 1px 3px rgba(0,0,0,0.35)";
    element.style.transform = "translate(-2px, -2px) scale(1)";
    element.style.transformOrigin = "top left";
    element.style.pointerEvents = "none";
    element.style.zIndex = "2147483647";
    element.style.opacity = "0";
    element.style.transition = "opacity 80ms linear, transform 60ms linear";
    root.appendChild(element);
    overlay = element;
    return overlay;
  };

  const render = () => {
    frame = 0;
    const element = ensureOverlay();
    if (!element) {
      return;
    }
    element.style.left = x + "px";
    element.style.top = y + "px";
    element.style.opacity = "1";
  };

  const queueRender = () => {
    if (frame) {
      return;
    }
    frame = requestAnimationFrame(render);
  };

  const hide = () => {
    const element = ensureOverlay();
    if (!element) {
      return;
    }
    element.style.opacity = "0";
  };

  const handleMove = (event) => {
    x = event.clientX;
    y = event.clientY;
    queueRender();
  };

  const press = () => {
    const element = ensureOverlay();
    if (!element) {
      return;
    }
    element.style.transform = "translate(-2px, -2px) scale(0.9)";
  };

  const release = () => {
    const element = ensureOverlay();
    if (!element) {
      return;
    }
    element.style.transform = "translate(-2px, -2px) scale(1)";
  };

  const markScroll = () => {
    globalState.__tracerLastScrollAtMs = Date.now();
  };

  const install = () => {
    ensureOverlay();
    globalState.__tracerLastScrollAtMs = 0;
    window.addEventListener("mousemove", handleMove, { capture: true, passive: true });
    window.addEventListener("mouseleave", hide, { capture: true, passive: true });
    window.addEventListener("mousedown", press, { capture: true, passive: true });
    window.addEventListener("mouseup", release, { capture: true, passive: true });
    window.addEventListener("wheel", markScroll, { capture: true, passive: true });
    window.addEventListener("touchmove", markScroll, { capture: true, passive: true });
    document.addEventListener("scroll", markScroll, { capture: true, passive: true });
    window.addEventListener("blur", hide, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        hide();
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
`;

type PlaywrightModule = typeof import("playwright");
let playwrightModulePromise: Promise<PlaywrightModule> | null = null;

interface ScreenshotEncoding {
  fileExtension: "png" | "jpg";
  type: "png" | "jpeg";
  quality?: number;
}

interface WindowsScreencastFrame {
  buffer: Buffer;
  width: number;
  height: number;
  frameSwapWallTimeMs: number;
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "0";
  if (!playwrightModulePromise) {
    playwrightModulePromise = import("playwright");
  }
  return playwrightModulePromise;
}

export class SessionManager {
  private captureSettings: AppSettings;

  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;

  private sessionRoot: string | null = null;
  private eventsStream: WriteStream | null = null;
  private screenshotTimer: NodeJS.Timeout | null = null;

  private events: CaptureEvent[] = [];
  private eventById = new Map<string, CaptureEvent>();
  private screenshotPathById = new Map<string, string>();
  private screenshotThumbnailPathById = new Map<string, string>();
  private lastScreenshotEvent: ScreenshotEvent | null = null;
  private screenshotRun: Promise<void> | null = null;
  private thumbnailWritesByPath = new Map<string, Promise<void>>();
  private windowsScreencastActive = false;
  private latestWindowsScreencastFrame: WindowsScreencastFrame | null = null;

  private responseByRequestId = new Map<string, PendingResponse>();
  private requestUrlById = new Map<string, string>();
  private pausedStartedAtMs: number | null = null;
  private pausedAccumulatedMs = 0;

  private status: SessionStatus = JSON.parse(JSON.stringify(STATUS_TEMPLATE)) as SessionStatus;
  private containsBodies = false;
  private appVersion = app.getVersion();
  private listenersAttached = false;

  constructor(settings: AppSettings) {
    this.captureSettings = normalizeAppSettings(settings);
  }

  public updateSettings(settings: AppSettings): void {
    this.captureSettings = normalizeAppSettings(settings);
  }

  private readonly pageCloseHandler = (): void => {
    void this.onBrowserClosed("page_closed");
  };

  private readonly contextCloseHandler = (): void => {
    void this.onBrowserClosed("context_closed");
  };

  private readonly pageLoadHandler = (): void => {
    if (!this.captureSettings.screenshotOnPageLoad) {
      return;
    }
    void this.captureScreenshot("load");
  };

  private readonly pageDomContentLoadedHandler = (): void => {
    if (!this.captureSettings.screenshotOnPageLoad) {
      return;
    }
    void this.captureScreenshot("load");
  };

  private readonly consoleHandler = (message: ConsoleMessage): void => {
    void this.handleConsoleMessage(message);
  };

  private readonly requestWillBeSentHandler = (params: {
    requestId: string;
    type?: string;
    request: { method: string; url: string; headers?: Record<string, string>; postData?: string };
  }): void => {
    void this.handleRequestWillBeSent(params);
  };

  private readonly responseReceivedHandler = (params: {
    requestId: string;
    response: {
      url: string;
      status: number;
      statusText: string;
      headers?: Record<string, string>;
      mimeType?: string;
    };
  }): void => {
    this.handleResponseReceived(params);
  };

  private readonly loadingFinishedHandler = (params: { requestId: string }): void => {
    void this.handleLoadingFinished(params);
  };

  private readonly loadingFailedHandler = (params: {
    requestId: string;
    errorText: string;
    canceled?: boolean;
  }): void => {
    void this.handleLoadingFailed(params);
  };

  private readonly screencastFrameHandler = (params: {
    data: string;
    sessionId: number;
    metadata?: {
      timestamp?: number;
      deviceWidth?: number;
      deviceHeight?: number;
    };
  }): void => {
    this.handleWindowsScreencastFrame(params);
  };

  public getStatus(): SessionStatus {
    return this.cloneStatus();
  }

  public async launchBrowser(): Promise<SessionStatus> {
    try {
      await this.resetAllRuntime();
      await this.bootstrapLiveSession();

      if (!this.sessionRoot || !this.status.sessionId) {
        throw new Error("Session root initialization failed.");
      }

      const userDataDir = path.join(this.sessionRoot, "user-data");
      await ensureDir(userDataDir);

      const { chromium } = await loadPlaywright();
      this.context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null,
        ignoreHTTPSErrors: true,
        args: ["--start-maximized"]
      });

      this.page = this.context.pages()[0] ?? (await this.context.newPage());
      this.context.on("close", this.contextCloseHandler);
      this.page.on("close", this.pageCloseHandler);
      await this.installMouseCursorOverlay();
      await this.openDefaultStartUrl();

      this.status.state = "browser_ready";
      this.status.browserVersion = this.context.browser()?.version() ?? "unknown";
      this.status.lastError = null;
      return this.cloneStatus();
    } catch (error) {
      this.recordError(error, "Failed to launch browser.");
      throw error;
    }
  }

  public async startCapture(): Promise<SessionStatus> {
    try {
      if (this.status.state !== "browser_ready") {
        throw new Error("Capture can only start when browser is ready.");
      }
      if (!this.page || !this.context || !this.status.sessionId || !this.sessionRoot) {
        throw new Error("Browser session is not initialized.");
      }

      const eventsFilePath = path.join(this.sessionRoot, "events.ndjson");
      this.eventsStream = createWriteStream(eventsFilePath, { flags: "a", encoding: "utf8" });

      this.status.captureStartedAt = Date.now();
      this.status.captureEndedAt = null;
      this.status.state = "capturing";
      this.status.sessionFileName = this.buildArchiveFileName();
      this.pausedStartedAtMs = null;
      this.pausedAccumulatedMs = 0;

      this.cdp = await this.context.newCDPSession(this.page);
      await this.cdp.send("Network.enable", {
        maxPostDataSize: 1024 * 1024
      });

      this.attachCaptureListeners();
      await this.startWindowsScreencastIfNeeded();
      this.emitLifecycleEvent("capture_started");
      this.startScreenshotTimer();

      await this.captureScreenshot("manual-start");
      return this.cloneStatus();
    } catch (error) {
      this.recordError(error, "Failed to start capture.");
      throw error;
    }
  }

  public async pauseCapture(): Promise<SessionStatus> {
    try {
      if (this.status.state !== "capturing") {
        throw new Error("Capture can only be paused while capturing.");
      }

      this.clearCaptureTimer();
      await this.stopWindowsScreencastIfNeeded();
      this.detachCaptureListeners();
      this.emitLifecycleEvent("capture_paused");
      this.pausedStartedAtMs = Date.now();
      this.status.state = "paused";
      return this.cloneStatus();
    } catch (error) {
      this.recordError(error, "Failed to pause capture.");
      throw error;
    }
  }

  public async resumeCapture(): Promise<SessionStatus> {
    try {
      if (this.status.state !== "paused") {
        throw new Error("Capture can only be resumed while paused.");
      }
      if (!this.page || !this.context || !this.status.sessionId || !this.sessionRoot) {
        throw new Error("Browser session is not initialized.");
      }

      if (!this.cdp) {
        this.cdp = await this.context.newCDPSession(this.page);
        await this.cdp.send("Network.enable", {
          maxPostDataSize: 1024 * 1024
        });
      }

      this.consumePausedDuration();
      this.status.captureEndedAt = null;
      this.status.state = "capturing";
      this.attachCaptureListeners();
      await this.startWindowsScreencastIfNeeded();
      this.startScreenshotTimer();
      this.emitLifecycleEvent("capture_resumed");
      return this.cloneStatus();
    } catch (error) {
      this.recordError(error, "Failed to resume capture.");
      throw error;
    }
  }

  public async stopCapture(): Promise<SessionStatus> {
    return this.stopCaptureInternal("manual_stop");
  }

  public async stopCaptureAndSaveForAppClose(): Promise<void> {
    if (this.status.state !== "capturing" && this.status.state !== "paused") {
      return;
    }
    await this.stopCaptureInternal("app_close_confirmed");
  }

  public async save(filePath?: string, options?: SaveSessionOptions): Promise<SavedSessionResult> {
    try {
      if (!this.status.sessionId || !this.sessionRoot) {
        throw new Error("No active session available for save.");
      }
      if (this.status.state === "browser_ready") {
        throw new Error("Capture has not started yet.");
      }
      if (this.status.state === "capturing" || this.status.state === "paused") {
        await this.stopCaptureInternal("save_request");
      }

      await this.writeSessionMetadata();
      const exportRange = this.normalizeExportRange(this.sortEvents(this.events), options?.range ?? null);
      const outputPath = filePath ?? (await this.pickSavePath(exportRange));
      await ensureDir(path.dirname(outputPath));

      if (exportRange) {
        await this.saveRangeSnapshot(exportRange, outputPath);
      } else {
        await createSessionArchive({
          sessionRoot: this.sessionRoot,
          destinationZipPath: outputPath
        });
      }
      this.status.sessionFileName = path.basename(outputPath);

      return {
        path: outputPath,
        sessionId: this.status.sessionId
      };
    } catch (error) {
      this.recordError(error, "Failed to save session.");
      throw error;
    }
  }

  public async open(filePath?: string): Promise<SessionStatus> {
    try {
      const zipPath = filePath ?? (await this.pickOpenPath());
      if (!zipPath) {
        return this.cloneStatus();
      }
      await this.resetAllRuntime();
      const extractRoot = path.join(app.getPath("temp"), "tracer-desktop-open", randomUUID());
      await ensureDir(extractRoot);
      await extractSessionArchive(zipPath, extractRoot);

      const manifestPath = path.join(extractRoot, "manifest.json");
      const manifestRaw = await readFile(manifestPath, "utf8");
      const manifest = parseManifest(manifestRaw);
      const eventsPath = path.join(extractRoot, "events.ndjson");
      const events = await parseEventsNdjsonFile(eventsPath);

      this.sessionRoot = extractRoot;
      this.status = {
        state: "reviewing",
        sessionId: manifest.sessionId,
        sessionFileName: path.basename(zipPath),
        createdAt: manifest.createdAt,
        captureStartedAt: manifest.captureStartedAt,
        captureEndedAt: manifest.captureEndedAt,
        browserVersion: manifest.browserVersion,
        source: "archive",
        counts: {
          events: manifest.counts.events,
          screenshots: manifest.counts.screenshots,
          networkRequests: manifest.counts.networkRequests
        },
        lastError: null
      };
      this.containsBodies = manifest.flags.containsBodies;

      this.events = this.sortEvents(events);
      this.eventById.clear();
      this.screenshotPathById.clear();
      this.screenshotThumbnailPathById.clear();
      this.lastScreenshotEvent = null;
      for (const event of this.events) {
        this.eventById.set(event.id, event);
        if (event.kind === "screenshot") {
          const screenshotPath = path.join(extractRoot, event.path);
          this.screenshotPathById.set(event.screenshotId, screenshotPath);
          this.screenshotThumbnailPathById.set(
            event.screenshotId,
            this.toThumbnailAbsolutePath(screenshotPath)
          );
          this.lastScreenshotEvent = event;
        }
      }

      return this.cloneStatus();
    } catch (error) {
      this.recordError(error, "Failed to open session archive.");
      throw error;
    }
  }

  public async getTimeline(sessionId: string): Promise<CaptureEvent[]> {
    if (this.status.sessionId !== sessionId) {
      return [];
    }
    return this.sortEvents(this.events);
  }

  public async getEvent(eventId: string): Promise<CaptureEvent | null> {
    return this.eventById.get(eventId) ?? null;
  }

  public async getScreenshot(
    screenshotId: string,
    variant: "thumbnail" | "full" = "thumbnail"
  ): Promise<ScreenshotPayload | null> {
    const fullImagePath = this.screenshotPathById.get(screenshotId);
    if (!fullImagePath) {
      return null;
    }

    const fullExists = await this.pathExists(fullImagePath);
    if (!fullExists) {
      return null;
    }

    let targetPath = fullImagePath;
    if (variant === "thumbnail") {
      targetPath = await this.ensureThumbnailForScreenshot(screenshotId);
      if (!targetPath) {
        targetPath = fullImagePath;
      }
    }

    const relPath = this.toSessionRelativePath(targetPath);
    return {
      screenshotId,
      path: relPath,
      mimeType: this.inferImageMimeType(targetPath),
      url: this.toMediaUrl(targetPath),
      variant
    };
  }

  private async ensureThumbnailForScreenshot(screenshotId: string): Promise<string> {
    const imagePath = this.screenshotPathById.get(screenshotId);
    if (!imagePath) {
      return "";
    }

    const existingThumbnailPath =
      this.screenshotThumbnailPathById.get(screenshotId) ?? this.toThumbnailAbsolutePath(imagePath);
    this.screenshotThumbnailPathById.set(screenshotId, existingThumbnailPath);

    if (await this.pathExists(existingThumbnailPath)) {
      return existingThumbnailPath;
    }

    let writePromise = this.thumbnailWritesByPath.get(existingThumbnailPath);
    if (!writePromise) {
      writePromise = this.generateThumbnailFile(imagePath, existingThumbnailPath).finally(() => {
        this.thumbnailWritesByPath.delete(existingThumbnailPath);
      });
      this.thumbnailWritesByPath.set(existingThumbnailPath, writePromise);
    }

    try {
      await writePromise;
    } catch {
      return imagePath;
    }

    return (await this.pathExists(existingThumbnailPath)) ? existingThumbnailPath : imagePath;
  }

  private async generateThumbnailFile(imagePath: string, thumbnailPath: string): Promise<void> {
    const imageBuffer = await readFile(imagePath);
    const image = nativeImage.createFromBuffer(imageBuffer);
    if (image.isEmpty()) {
      throw new Error("Failed to decode screenshot image.");
    }

    const size = image.getSize();
    const width = Math.max(64, Math.min(TIMELINE_THUMBNAIL_WIDTH_PX, size.width || TIMELINE_THUMBNAIL_WIDTH_PX));
    const source = size.width > width ? image.resize({ width, quality: "good" }) : image;
    const thumbnailBuffer = source.toJPEG(TIMELINE_THUMBNAIL_QUALITY);
    await ensureDir(path.dirname(thumbnailPath));
    await writeFile(thumbnailPath, thumbnailBuffer);
  }

  private toThumbnailAbsolutePath(imagePath: string): string {
    const parsed = path.parse(imagePath);
    return path.join(parsed.dir, "thumbs", `${parsed.name}.jpg`);
  }

  private inferImageMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") {
      return "image/jpeg";
    }
    if (ext === ".webp") {
      return "image/webp";
    }
    return "image/png";
  }

  private toMediaUrl(filePath: string): string {
    const absolutePath = path.resolve(filePath);
    const encodedPath = Buffer.from(absolutePath, "utf8").toString("base64url");
    return `${TRACER_MEDIA_PROTOCOL_SCHEME}://file/${encodedPath}`;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public async getNetworkBody(bodyPath: string): Promise<NetworkBodyPayload | null> {
    if (!this.sessionRoot) {
      return null;
    }
    const relativePath = this.toSafeRelativePath(bodyPath);
    if (!relativePath) {
      return null;
    }

    const absolutePath = path.join(this.sessionRoot, relativePath);
    let data: Buffer;
    try {
      data = await readFile(absolutePath);
    } catch {
      return null;
    }

    const maxTextBytes = 2 * 1024 * 1024;
    const payload: NetworkBodyPayload = {
      bodyPath: toPosixPath(relativePath),
      sizeBytes: data.length
    };

    if (this.isLikelyTextBody(data)) {
      const truncated = data.length > maxTextBytes;
      const slice = truncated ? data.subarray(0, maxTextBytes) : data;
      payload.text = slice.toString("utf8");
      if (truncated) {
        payload.truncated = true;
      }
      return payload;
    }

    payload.base64 = data.toString("base64");
    return payload;
  }

  public async dispose(): Promise<void> {
    await this.resetAllRuntime();
  }

  private async bootstrapLiveSession(): Promise<void> {
    const sessionId = randomUUID();
    const root = path.join(app.getPath("temp"), "tracer-desktop-live", sessionId);
    await Promise.all([
      ensureDir(root),
      ensureDir(path.join(root, "screenshots")),
      ensureDir(path.join(root, "network", "bodies")),
      ensureDir(path.join(root, "meta"))
    ]);

    this.sessionRoot = root;
    this.events = [];
    this.eventById.clear();
    this.screenshotPathById.clear();
    this.screenshotThumbnailPathById.clear();
    this.lastScreenshotEvent = null;
    this.requestUrlById.clear();
    this.responseByRequestId.clear();
    this.containsBodies = false;
    this.windowsScreencastActive = false;
    this.latestWindowsScreencastFrame = null;

    this.status = {
      state: "idle",
      sessionId,
      sessionFileName: null,
      createdAt: Date.now(),
      captureStartedAt: null,
      captureEndedAt: null,
      browserVersion: null,
      source: "live",
      counts: {
        events: 0,
        screenshots: 0,
        networkRequests: 0
      },
      lastError: null
    };

    await this.writeVersionFile();
  }

  private async stopCaptureInternal(reason: string): Promise<SessionStatus> {
    if (this.status.state !== "capturing" && this.status.state !== "paused") {
      return this.cloneStatus();
    }

    if (this.status.state === "paused") {
      this.consumePausedDuration();
    }

    this.clearCaptureTimer();
    await this.stopWindowsScreencastIfNeeded();
    this.detachCaptureListeners();
    await this.waitForOngoingScreenshot();

    this.emitLifecycleEvent("capture_stopped", reason);
    this.status.captureEndedAt = Date.now();
    this.status.state = "captured";

    await this.flushEventsStream();
    await this.writeSessionMetadata();

    const shouldPersistAutoSave =
      reason === "app_close_confirmed" ||
      (this.captureSettings.autoSaveOnStopOrClose &&
        (reason === "manual_stop" || reason === "page_closed" || reason === "context_closed"));

    if (shouldPersistAutoSave) {
      await this.persistAutoSaves();
    }

    return this.cloneStatus();
  }

  private attachCaptureListeners(): void {
    if (!this.page || !this.cdp || this.listenersAttached) {
      return;
    }
    this.page.on("domcontentloaded", this.pageDomContentLoadedHandler);
    this.page.on("load", this.pageLoadHandler);
    this.page.on("console", this.consoleHandler);

    this.cdp.on("Network.requestWillBeSent", this.requestWillBeSentHandler);
    this.cdp.on("Network.responseReceived", this.responseReceivedHandler);
    this.cdp.on("Network.loadingFinished", this.loadingFinishedHandler);
    this.cdp.on("Network.loadingFailed", this.loadingFailedHandler);
    if (process.platform === "win32") {
      this.cdp.on("Page.screencastFrame", this.screencastFrameHandler);
    }

    this.listenersAttached = true;
  }

  private detachCaptureListeners(): void {
    if (!this.listenersAttached) {
      return;
    }

    if (this.page) {
      this.page.off("domcontentloaded", this.pageDomContentLoadedHandler);
      this.page.off("load", this.pageLoadHandler);
      this.page.off("console", this.consoleHandler);
    }
    if (this.cdp) {
      this.cdp.off("Network.requestWillBeSent", this.requestWillBeSentHandler);
      this.cdp.off("Network.responseReceived", this.responseReceivedHandler);
      this.cdp.off("Network.loadingFinished", this.loadingFinishedHandler);
      this.cdp.off("Network.loadingFailed", this.loadingFailedHandler);
      if (process.platform === "win32") {
        this.cdp.off("Page.screencastFrame", this.screencastFrameHandler);
      }
    }
    this.listenersAttached = false;
  }

  private clearCaptureTimer(): void {
    if (this.screenshotTimer) {
      clearInterval(this.screenshotTimer);
      this.screenshotTimer = null;
    }
  }

  private startScreenshotTimer(): void {
    this.clearCaptureTimer();
    this.screenshotTimer = setInterval(() => {
      void this.captureScreenshot("timer");
    }, this.captureSettings.screenshotIntervalMs);
  }

  private emitLifecycleEvent(action: LifecycleEvent["action"], reason?: string): void {
    const timelineCaptureStartAtMs = this.getTimelineCaptureStartAtMs();
    if (!this.status.sessionId || timelineCaptureStartAtMs === null) {
      return;
    }
    const base = createBaseEvent({
      sessionId: this.status.sessionId,
      captureStartAtMs: timelineCaptureStartAtMs,
      kind: "lifecycle",
      pageUrl: this.page?.url()
    });
    const event: LifecycleEvent = {
      ...base,
      kind: "lifecycle",
      action,
      reason
    };
    this.appendEvent(event);
  }

  private appendEvent(event: CaptureEvent): void {
    this.events.push(event);
    this.eventById.set(event.id, event);

    this.status.counts.events += 1;
    if (event.kind === "screenshot") {
      this.status.counts.screenshots += 1;
      const screenshotPath = path.join(this.sessionRoot ?? "", event.path);
      this.screenshotPathById.set(event.screenshotId, screenshotPath);
      this.screenshotThumbnailPathById.set(
        event.screenshotId,
        this.toThumbnailAbsolutePath(screenshotPath)
      );
      this.lastScreenshotEvent = event;
    }
    if (event.kind === "network_request") {
      this.status.counts.networkRequests += 1;
    }

    if (this.eventsStream) {
      this.eventsStream.write(serializeEventLine(event));
    }
  }

  private async handleConsoleMessage(message: ConsoleMessage): Promise<void> {
    const timelineCaptureStartAtMs = this.getTimelineCaptureStartAtMs();
    if (!this.isCapturing() || !this.status.sessionId || timelineCaptureStartAtMs === null) {
      return;
    }

    const level = normalizeConsoleLevel(message.type());
    let argsJson: string | undefined;
    try {
      const args = await Promise.all(message.args().map(async (arg) => arg.jsonValue()));
      argsJson = JSON.stringify(args);
    } catch {
      argsJson = undefined;
    }

    const base = createBaseEvent({
      sessionId: this.status.sessionId,
      captureStartAtMs: timelineCaptureStartAtMs,
      kind: "console",
      pageUrl: this.page?.url()
    });
    const event: ConsoleEvent = {
      ...base,
      kind: "console",
      level,
      text: message.text(),
      argsJson
    };
    this.appendEvent(event);

    if (level === "error" && this.captureSettings.screenshotOnConsoleError) {
      await this.captureScreenshot("console-error");
    }
  }

  private async handleRequestWillBeSent(params: {
    requestId: string;
    type?: string;
    request: { method: string; url: string; headers?: Record<string, string>; postData?: string };
  }): Promise<void> {
    const timelineCaptureStartAtMs = this.getTimelineCaptureStartAtMs();
    if (!this.isCapturing() || !this.status.sessionId || timelineCaptureStartAtMs === null) {
      return;
    }

    this.requestUrlById.set(params.requestId, params.request.url);

    const base = createBaseEvent({
      sessionId: this.status.sessionId,
      captureStartAtMs: timelineCaptureStartAtMs,
      kind: "network_request",
      pageUrl: this.page?.url()
    });

    const event: NetworkRequestEvent = {
      ...base,
      kind: "network_request",
      requestId: params.requestId,
      method: params.request.method,
      url: params.request.url,
      headers: params.request.headers ?? {},
      postData: params.request.postData,
      resourceType: params.type
    };
    this.appendEvent(event);

    if (this.captureSettings.screenshotOnPageLoad && params.type === "Document") {
      void this.captureScreenshot("load");
    }
  }

  private handleResponseReceived(params: {
    requestId: string;
    response: {
      url: string;
      status: number;
      statusText: string;
      headers?: Record<string, string>;
      mimeType?: string;
    };
  }): void {
    const timelineCaptureStartAtMs = this.getTimelineCaptureStartAtMs();
    if (!this.isCapturing() || !this.status.sessionId || timelineCaptureStartAtMs === null) {
      return;
    }

    const response: PendingResponse = {
      requestId: params.requestId,
      url: params.response.url,
      status: params.response.status,
      statusText: params.response.statusText,
      headers: params.response.headers ?? {},
      mimeType: params.response.mimeType
    };
    this.responseByRequestId.set(params.requestId, response);

    // Emit response metadata immediately so inspector tabs can show status/headers
    // even if body capture on loadingFinished is unavailable.
    this.appendNetworkResponseEvent(response, timelineCaptureStartAtMs);
  }

  private async handleLoadingFinished(params: { requestId: string }): Promise<void> {
    const timelineCaptureStartAtMs = this.getTimelineCaptureStartAtMs();
    if (!this.isCapturing() || !this.status.sessionId || timelineCaptureStartAtMs === null) {
      return;
    }
    const response = this.responseByRequestId.get(params.requestId);
    if (!response) {
      return;
    }

    let bodyPath: string | undefined;
    if (this.cdp) {
      try {
        const responseBody = await this.cdp.send("Network.getResponseBody", {
          requestId: params.requestId
        });
        if (responseBody?.body) {
          bodyPath = path.join(
            "network",
            "bodies",
            `${sanitizeFileFragment(params.requestId)}-${Date.now()}.bin`
          );
          const bodyAbsPath = path.join(this.sessionRoot ?? "", bodyPath);
          await ensureDir(path.dirname(bodyAbsPath));
          const data = responseBody.base64Encoded
            ? Buffer.from(responseBody.body, "base64")
            : Buffer.from(responseBody.body, "utf8");
          await writeFile(bodyAbsPath, data);
          this.containsBodies = true;
        }
      } catch {
        bodyPath = undefined;
      }
    }

    if (bodyPath) {
      // Emit an enrichment response event that includes persisted body path.
      this.appendNetworkResponseEvent(response, timelineCaptureStartAtMs, bodyPath);
    }
    this.responseByRequestId.delete(params.requestId);
    this.requestUrlById.delete(params.requestId);
  }

  private async handleLoadingFailed(params: {
    requestId: string;
    errorText: string;
    canceled?: boolean;
  }): Promise<void> {
    const timelineCaptureStartAtMs = this.getTimelineCaptureStartAtMs();
    if (!this.isCapturing() || !this.status.sessionId || timelineCaptureStartAtMs === null) {
      return;
    }

    const base = createBaseEvent({
      sessionId: this.status.sessionId,
      captureStartAtMs: timelineCaptureStartAtMs,
      kind: "network_fail",
      pageUrl: this.page?.url()
    });
    const event: NetworkFailEvent = {
      ...base,
      kind: "network_fail",
      requestId: params.requestId,
      url: this.requestUrlById.get(params.requestId),
      errorText: params.errorText,
      canceled: Boolean(params.canceled)
    };
    this.appendEvent(event);

    this.responseByRequestId.delete(params.requestId);
    this.requestUrlById.delete(params.requestId);
    if (this.captureSettings.screenshotOnNetworkFail) {
      await this.captureScreenshot("network-fail");
    }
  }

  private appendNetworkResponseEvent(
    response: PendingResponse,
    timelineCaptureStartAtMs: number,
    bodyPath?: string
  ): void {
    if (!this.status.sessionId) {
      return;
    }
    const base = createBaseEvent({
      sessionId: this.status.sessionId,
      captureStartAtMs: timelineCaptureStartAtMs,
      kind: "network_response",
      pageUrl: this.page?.url()
    });
    const event: NetworkResponseEvent = {
      ...base,
      kind: "network_response",
      requestId: response.requestId,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      mimeType: response.mimeType,
      bodyPath
    };
    this.appendEvent(event);
  }

  private async startWindowsScreencastIfNeeded(): Promise<void> {
    if (process.platform !== "win32" || !this.cdp || this.windowsScreencastActive) {
      return;
    }
    try {
      await this.cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: WINDOWS_SCREENCAST_QUALITY,
        maxWidth: WINDOWS_SCREENCAST_MAX_WIDTH,
        maxHeight: WINDOWS_SCREENCAST_MAX_HEIGHT,
        everyNthFrame: 1
      });
      this.windowsScreencastActive = true;
    } catch (error) {
      this.windowsScreencastActive = false;
      log.warn("Failed to start Windows screencast capture. Falling back to page screenshots.", error);
    }
  }

  private async stopWindowsScreencastIfNeeded(): Promise<void> {
    if (process.platform !== "win32") {
      return;
    }

    this.latestWindowsScreencastFrame = null;
    if (!this.cdp || !this.windowsScreencastActive) {
      this.windowsScreencastActive = false;
      return;
    }

    try {
      await this.cdp.send("Page.stopScreencast");
    } catch {
      // ignore stop errors during teardown
    } finally {
      this.windowsScreencastActive = false;
    }
  }

  private handleWindowsScreencastFrame(params: {
    data: string;
    sessionId: number;
    metadata?: {
      timestamp?: number;
      deviceWidth?: number;
      deviceHeight?: number;
    };
  }): void {
    const cdp = this.cdp;
    if (cdp) {
      void cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {
        // ignore ack errors for disposed sessions
      });
    }

    if (process.platform !== "win32" || !this.isCapturing()) {
      return;
    }

    try {
      const buffer = Buffer.from(params.data, "base64");
      if (buffer.length === 0) {
        return;
      }
      const width = params.metadata?.deviceWidth ?? 0;
      const height = params.metadata?.deviceHeight ?? 0;
      const frameSwapWallTimeMs = params.metadata?.timestamp
        ? Math.round(params.metadata.timestamp * 1000)
        : Date.now();
      this.latestWindowsScreencastFrame = {
        buffer,
        width,
        height,
        frameSwapWallTimeMs
      };
    } catch {
      // ignore malformed frame payloads
    }
  }

  private getLatestWindowsScreencastFrame(): WindowsScreencastFrame | null {
    const frame = this.latestWindowsScreencastFrame;
    if (!frame || frame.buffer.length === 0) {
      return null;
    }
    return frame;
  }

  private async waitForWindowsScreencastFrame(
    waitMs: number
  ): Promise<WindowsScreencastFrame | null> {
    let frame = this.getLatestWindowsScreencastFrame();
    if (frame || waitMs <= 0 || !this.windowsScreencastActive) {
      return frame;
    }

    const deadlineAt = Date.now() + waitMs;
    while (!frame && this.windowsScreencastActive && this.isCapturing() && Date.now() < deadlineAt) {
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      frame = this.getLatestWindowsScreencastFrame();
    }
    return frame;
  }

  private resolveWindowsScreencastWaitMs(reason: ScreenshotEvent["reason"]): number {
    if (process.platform !== "win32" || !this.windowsScreencastActive) {
      return 0;
    }
    if (this.getLatestWindowsScreencastFrame()) {
      return 0;
    }
    return reason === "manual-start"
      ? WINDOWS_SCREENCAST_FIRST_FRAME_WAIT_MS
      : WINDOWS_SCREENCAST_FRAME_WAIT_MS;
  }

  private async captureScreenshotFromWindowsScreencast(
    reason: ScreenshotEvent["reason"],
    waitForFrameMs = 0
  ): Promise<boolean> {
    if (process.platform !== "win32" || !this.isCapturing() || !this.sessionRoot || !this.status.sessionId) {
      return false;
    }

    const frame = await this.waitForWindowsScreencastFrame(waitForFrameMs);
    if (!frame || frame.buffer.length === 0) {
      return false;
    }

    const timelineCaptureStartAtMs = this.getTimelineCaptureStartAtMs();
    if (timelineCaptureStartAtMs === null) {
      return false;
    }

    const screenshotId = randomUUID();
    const relativePath = path.join(
      "screenshots",
      `${Date.now()}-${sanitizeFileFragment(screenshotId.slice(0, 8))}.jpg`
    );
    const absolutePath = path.join(this.sessionRoot, relativePath);

    try {
      await ensureDir(path.dirname(absolutePath));
      await writeFile(absolutePath, frame.buffer);
    } catch {
      return false;
    }

    const viewport = this.page?.viewportSize();
    const width = frame.width || viewport?.width || 0;
    const height = frame.height || viewport?.height || 0;

    const base = createBaseEvent({
      sessionId: this.status.sessionId,
      captureStartAtMs: timelineCaptureStartAtMs,
      kind: "screenshot",
      pageUrl: this.page?.url()
    });

    const event: ScreenshotEvent = {
      ...base,
      kind: "screenshot",
      screenshotId,
      path: relativePath.split(path.sep).join("/"),
      width,
      height,
      reason
    };

    this.appendEvent(event);
    void this.ensureThumbnailForScreenshot(screenshotId).catch((error) => {
      log.warn("Failed to pre-generate screenshot thumbnail.", error);
    });
    return true;
  }

  private async captureScreenshot(
    reason: ScreenshotEvent["reason"]
  ): Promise<void> {
    if (process.platform === "win32") {
      await this.startWindowsScreencastIfNeeded();
      const waitForFrameMs = this.resolveWindowsScreencastWaitMs(reason);
      const capturedFromScreencast = await this.captureScreenshotFromWindowsScreencast(
        reason,
        waitForFrameMs
      );
      if (capturedFromScreencast) {
        return;
      }
      if (this.windowsScreencastActive) {
        this.appendFallbackScreenshotFromLast(reason);
        return;
      }
    }

    if (process.platform === "darwin" && reason === "timer") {
      const scrollingNow = await this.isMacScrollActive();
      if (scrollingNow) {
        return;
      }
    }

    if (reason === "timer" && this.screenshotRun) {
      if (process.platform === "darwin") {
        return;
      }
      this.appendFallbackScreenshotFromLast(reason);
      return;
    }

    if (this.screenshotRun) {
      await this.waitForOngoingScreenshot();
    }

    const run = this.captureScreenshotInternal(reason);
    this.screenshotRun = run;
    try {
      await run;
    } finally {
      if (this.screenshotRun === run) {
        this.screenshotRun = null;
      }
    }
  }

  private async captureScreenshotInternal(
    reason: ScreenshotEvent["reason"]
  ): Promise<void> {
    if (!this.isCapturing() || !this.page || this.page.isClosed()) {
      return;
    }
    const timelineCaptureStartAtMs = this.getTimelineCaptureStartAtMs();
    if (!this.status.sessionId || timelineCaptureStartAtMs === null || !this.sessionRoot) {
      return;
    }

    const encoding = this.resolveScreenshotEncoding(reason);
    const screenshotId = randomUUID();
    const relativePath = path.join(
      "screenshots",
      `${Date.now()}-${sanitizeFileFragment(screenshotId.slice(0, 8))}.${encoding.fileExtension}`
    );
    const absolutePath = path.join(this.sessionRoot, relativePath);
    await ensureDir(path.dirname(absolutePath));

    try {
      await this.captureScreenshotWithRetry(absolutePath, reason, encoding);
    } catch (error) {
      log.warn(`Failed to capture screenshot (${reason}).`, error);
      try {
        await unlink(absolutePath);
      } catch {
        // ignore unlink failures for partial captures
      }
      this.appendFallbackScreenshotFromLast(reason);
      return;
    }

    const viewport = this.page.viewportSize();
    const width = viewport?.width ?? 0;
    const height = viewport?.height ?? 0;

    const base = createBaseEvent({
      sessionId: this.status.sessionId,
      captureStartAtMs: timelineCaptureStartAtMs,
      kind: "screenshot",
      pageUrl: this.page.url()
    });

    const event: ScreenshotEvent = {
      ...base,
      kind: "screenshot",
      screenshotId,
      path: relativePath.split(path.sep).join("/"),
      width,
      height,
      reason
    };
    this.appendEvent(event);
    void this.ensureThumbnailForScreenshot(screenshotId).catch((error) => {
      log.warn("Failed to pre-generate screenshot thumbnail.", error);
    });
  }

  private async captureScreenshotWithRetry(
    absolutePath: string,
    reason: ScreenshotEvent["reason"],
    encoding: ScreenshotEncoding
  ): Promise<void> {
    const isTimerCapture = reason === "timer";
    const isWindows = process.platform === "win32";
    const skipFullPageForPlatformTimer =
      isTimerCapture && (process.platform === "darwin" || isWindows);
    const skipFullPageOnWindows = isWindows;

    const useFullPageFirstAttempt =
      this.captureSettings.fullPageScreenshots &&
      !skipFullPageForPlatformTimer &&
      !skipFullPageOnWindows;

    const attempts = useFullPageFirstAttempt
      ? [
          { waitMs: 0, fullPage: true, timeoutMs: 1200 },
          { waitMs: 90, fullPage: false, timeoutMs: 1400 },
          { waitMs: 180, fullPage: false, timeoutMs: 1800 }
        ]
      : [
          { waitMs: 0, fullPage: false, timeoutMs: 1200 },
          { waitMs: 90, fullPage: false, timeoutMs: 1400 },
          { waitMs: 180, fullPage: false, timeoutMs: 1800 }
        ];

    let lastError: unknown;
    for (const attempt of attempts) {
      if (!this.isCapturing() || !this.page || this.page.isClosed()) {
        return;
      }
      if (attempt.waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, attempt.waitMs));
      }

      try {
        const screenshotOptions: Parameters<Page["screenshot"]>[0] = {
          path: absolutePath,
          fullPage: attempt.fullPage,
          timeout: attempt.timeoutMs,
          type: encoding.type
        };
        if (encoding.type === "jpeg") {
          screenshotOptions.quality = encoding.quality ?? MAC_EVENT_JPEG_QUALITY;
        }
        await this.page.screenshot(screenshotOptions);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw (
      lastError ??
      new Error(`Screenshot capture failed after retries for reason "${reason}".`)
    );
  }

  private appendFallbackScreenshotFromLast(reason: ScreenshotEvent["reason"]): void {
    if (!this.isCapturing() || !this.lastScreenshotEvent || !this.status.sessionId) {
      return;
    }
    const timelineCaptureStartAtMs = this.getTimelineCaptureStartAtMs();
    if (timelineCaptureStartAtMs === null) {
      return;
    }

    const base = createBaseEvent({
      sessionId: this.status.sessionId,
      captureStartAtMs: timelineCaptureStartAtMs,
      kind: "screenshot",
      pageUrl: this.page?.url() ?? this.lastScreenshotEvent.pageUrl
    });

    const fallbackEvent: ScreenshotEvent = {
      ...base,
      kind: "screenshot",
      screenshotId: randomUUID(),
      path: this.lastScreenshotEvent.path,
      width: this.lastScreenshotEvent.width,
      height: this.lastScreenshotEvent.height,
      reason
    };
    this.appendEvent(fallbackEvent);
  }

  private resolveScreenshotEncoding(reason: ScreenshotEvent["reason"]): ScreenshotEncoding {
    if (process.platform !== "darwin") {
      return {
        fileExtension: "png",
        type: "png"
      };
    }

    if (reason === "timer") {
      return {
        fileExtension: "jpg",
        type: "jpeg",
        quality: MAC_TIMER_JPEG_QUALITY
      };
    }

    return {
      fileExtension: "jpg",
      type: "jpeg",
      quality: MAC_EVENT_JPEG_QUALITY
    };
  }

  private async isMacScrollActive(): Promise<boolean> {
    if (process.platform !== "darwin" || !this.page || this.page.isClosed()) {
      return false;
    }

    try {
      const isScrolling = await this.page.evaluate((cooldownMs) => {
        const state = globalThis as { __tracerLastScrollAtMs?: number };
        const lastScrollAtMs =
          typeof state.__tracerLastScrollAtMs === "number" ? state.__tracerLastScrollAtMs : 0;
        return Date.now() - lastScrollAtMs <= cooldownMs;
      }, MAC_SCROLL_CAPTURE_COOLDOWN_MS);
      return Boolean(isScrolling);
    } catch {
      return false;
    }
  }

  private async waitForOngoingScreenshot(): Promise<void> {
    const run = this.screenshotRun;
    if (!run) {
      return;
    }
    try {
      await run;
    } catch {
      // errors are already handled inside capture routines
    }
  }

  private async onBrowserClosed(reason: string): Promise<void> {
    if (this.status.state === "capturing" || this.status.state === "paused") {
      await this.stopCaptureInternal(reason);
    }
    this.detachCaptureListeners();
    this.clearCaptureTimer();
    this.context = null;
    this.page = null;
    this.cdp = null;

    if (this.status.state === "browser_ready") {
      this.status.state = "idle";
      this.status.sessionId = null;
      this.status.sessionFileName = null;
      this.status.source = null;
    }
  }

  private async openDefaultStartUrl(): Promise<void> {
    if (!this.page || this.page.isClosed()) {
      return;
    }
    const defaultStartUrl = this.captureSettings.defaultStartUrl.trim();
    if (!defaultStartUrl) {
      return;
    }
    try {
      await this.page.goto(defaultStartUrl, {
        waitUntil: "domcontentloaded"
      });
    } catch (error) {
      log.warn("Failed to open configured default start URL.", error);
    }
  }

  private async installMouseCursorOverlay(): Promise<void> {
    if (!this.context || !this.page || this.page.isClosed()) {
      return;
    }
    try {
      await this.context.addInitScript({ content: CURSOR_OVERLAY_INIT_SCRIPT });
      await this.page.evaluate((script) => {
        const run = new Function(script);
        run();
      }, CURSOR_OVERLAY_INIT_SCRIPT);
    } catch (error) {
      log.warn("Failed to install cursor overlay.", error);
    }
  }

  private async resetAllRuntime(): Promise<void> {
    this.clearCaptureTimer();
    this.detachCaptureListeners();
    await this.waitForOngoingScreenshot();
    await this.flushEventsStream();

    if (this.page) {
      this.page.off("close", this.pageCloseHandler);
    }
    if (this.context) {
      this.context.off("close", this.contextCloseHandler);
      try {
        await this.context.close();
      } catch (error) {
        log.warn("Ignoring browser close error during reset.", error);
      }
    }

    this.context = null;
    this.page = null;
    this.cdp = null;

    this.events = [];
    this.eventById.clear();
    this.screenshotPathById.clear();
    this.screenshotThumbnailPathById.clear();
    this.lastScreenshotEvent = null;
    this.requestUrlById.clear();
    this.responseByRequestId.clear();
    this.thumbnailWritesByPath.clear();
    this.sessionRoot = null;
    this.containsBodies = false;
    this.windowsScreencastActive = false;
    this.latestWindowsScreencastFrame = null;
    this.screenshotRun = null;
    this.pausedStartedAtMs = null;
    this.pausedAccumulatedMs = 0;
    this.status = JSON.parse(JSON.stringify(STATUS_TEMPLATE)) as SessionStatus;
  }

  private async flushEventsStream(): Promise<void> {
    if (!this.eventsStream) {
      return;
    }
    const stream = this.eventsStream;
    this.eventsStream = null;
    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on("error", (error) => reject(error));
    });
  }

  private async writeVersionFile(): Promise<void> {
    if (!this.sessionRoot) {
      return;
    }
    await this.writeVersionFileForRoot(this.sessionRoot);
  }

  private async writeVersionFileForRoot(rootPath: string): Promise<void> {
    const versionPath = path.join(rootPath, "meta", "version.json");
    await ensureDir(path.dirname(versionPath));
    await writeFile(versionPath, JSON.stringify({ schemaVersion: SCHEMA_VERSION }, null, 2), "utf8");
  }

  private async writeSessionMetadata(): Promise<void> {
    if (!this.sessionRoot || !this.status.sessionId || !this.status.createdAt) {
      return;
    }
    const manifest: SessionManifest = buildManifest({
      sessionId: this.status.sessionId,
      createdAt: this.status.createdAt,
      browserVersion: this.status.browserVersion,
      appVersion: this.appVersion,
      captureStartedAt: this.status.captureStartedAt,
      captureEndedAt: this.status.captureEndedAt,
      counts: this.status.counts,
      containsBodies: this.containsBodies
    });
    const manifestPath = path.join(this.sessionRoot, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    await this.writeVersionFile();
  }

  private async persistAutoSaves(): Promise<void> {
    if (!this.sessionRoot || !this.status.sessionId) {
      return;
    }

    const archiveName = this.buildArchiveFileName();

    const tempAutoSaveDir = path.join(app.getPath("temp"), "tracer-desktop-autosave");
    const tempArchivePath = path.join(tempAutoSaveDir, archiveName);

    try {
      await ensureDir(tempAutoSaveDir);
      await this.createArchiveSnapshot(tempArchivePath);
      await this.pruneOldAutoSaves(tempAutoSaveDir, MAX_TEMP_AUTOSAVES);
    } catch (error) {
      log.warn("Failed to persist temporary auto-save archive.", error);
    }

    const defaultDir = this.captureSettings.defaultSessionSaveDir.trim();
    if (defaultDir.length === 0) {
      return;
    }

    const defaultArchivePath = path.join(defaultDir, archiveName);
    if (path.resolve(defaultArchivePath) === path.resolve(tempArchivePath)) {
      return;
    }

    try {
      await ensureDir(defaultDir);
      await this.createArchiveSnapshot(defaultArchivePath);
    } catch (error) {
      log.warn("Failed to persist auto-save archive in default directory.", error);
    }
  }

  private async createArchiveSnapshot(destinationZipPath: string): Promise<void> {
    if (!this.sessionRoot) {
      return;
    }
    await createSessionArchive({
      sessionRoot: this.sessionRoot,
      destinationZipPath
    });
  }

  private async saveRangeSnapshot(
    range: { startMs: number; endMs: number },
    destinationZipPath: string
  ): Promise<void> {
    if (!this.sessionRoot) {
      throw new Error("Session root is not available for range export.");
    }

    const filteredEvents = this.sortEvents(this.events).filter((event) => {
      return event.tRelMs >= range.startMs && event.tRelMs <= range.endMs;
    });
    if (filteredEvents.length === 0) {
      throw new Error("No events found in the selected range.");
    }

    const exportRoot = path.join(app.getPath("temp"), "tracer-desktop-range-export", randomUUID());
    await ensureDir(path.join(exportRoot, "meta"));

    try {
      await this.copyRangeAssets(filteredEvents, exportRoot);
      const ndjson = filteredEvents.map((event) => serializeEventLine(event)).join("");
      await writeFile(path.join(exportRoot, "events.ndjson"), ndjson, "utf8");
      await this.writeRangeSessionMetadata(exportRoot, filteredEvents);
      await this.writeVersionFileForRoot(exportRoot);
      await createSessionArchive({
        sessionRoot: exportRoot,
        destinationZipPath
      });
    } finally {
      await rm(exportRoot, { recursive: true, force: true });
    }
  }

  private async copyRangeAssets(events: CaptureEvent[], exportRoot: string): Promise<void> {
    if (!this.sessionRoot) {
      return;
    }

    const assets = new Set<string>();
    for (const event of events) {
      if (event.kind === "screenshot") {
        assets.add(event.path);
        const fullPath = this.screenshotPathById.get(event.screenshotId);
        const thumbnailPath = this.screenshotThumbnailPathById.get(event.screenshotId);
        if (fullPath && thumbnailPath) {
          const thumbnailRel = this.toSessionRelativePath(thumbnailPath);
          if (thumbnailRel) {
            assets.add(thumbnailRel);
          }
        }
      }
      if (event.kind === "network_response" && event.bodyPath) {
        assets.add(event.bodyPath);
      }
    }

    for (const relativePath of assets) {
      const normalized = this.toSafeRelativePath(relativePath);
      if (!normalized) {
        continue;
      }
      const sourcePath = path.join(this.sessionRoot, normalized);
      const targetPath = path.join(exportRoot, normalized);
      try {
        await ensureDir(path.dirname(targetPath));
        await copyFile(sourcePath, targetPath);
      } catch (error) {
        log.warn(`Failed to include range asset "${normalized}" in archive.`, error);
      }
    }
  }

  private async writeRangeSessionMetadata(exportRoot: string, events: CaptureEvent[]): Promise<void> {
    if (!this.status.sessionId || !this.status.createdAt) {
      throw new Error("Session metadata is unavailable for range export.");
    }

    const sorted = this.sortEvents(events);
    const firstEvent = sorted[0];
    const lastEvent = sorted[sorted.length - 1];
    const containsBodies = sorted.some((event) => event.kind === "network_response" && Boolean(event.bodyPath));

    const manifest: SessionManifest = buildManifest({
      sessionId: this.status.sessionId,
      createdAt: this.status.createdAt,
      browserVersion: this.status.browserVersion,
      appVersion: this.appVersion,
      captureStartedAt: firstEvent?.tsMs ?? this.status.captureStartedAt,
      captureEndedAt: lastEvent?.tsMs ?? this.status.captureEndedAt,
      counts: {
        events: sorted.length,
        screenshots: sorted.filter((event) => event.kind === "screenshot").length,
        networkRequests: sorted.filter((event) => event.kind === "network_request").length
      },
      containsBodies
    });
    await writeFile(path.join(exportRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  }

  private normalizeExportRange(
    sortedEvents: CaptureEvent[],
    range: SaveSessionOptions["range"] | undefined
  ): { startMs: number; endMs: number } | null {
    if (!range) {
      return null;
    }
    const startRaw = Number(range.startMs);
    const endRaw = Number(range.endMs);
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) {
      throw new Error("Invalid range values.");
    }

    let startMs = Math.min(startRaw, endRaw);
    let endMs = Math.max(startRaw, endRaw);

    if (sortedEvents.length > 0) {
      const minRel = sortedEvents[0].tRelMs;
      const maxRel = sortedEvents[sortedEvents.length - 1].tRelMs;
      startMs = Math.max(minRel, startMs);
      endMs = Math.min(maxRel, endMs);
    }

    if (endMs < startMs) {
      throw new Error("Selected range is outside the captured timeline.");
    }
    return { startMs, endMs };
  }

  private toSafeRelativePath(relativePath: string): string | null {
    const normalized = path.normalize(relativePath).replace(/^[\\/]+/u, "");
    if (normalized.startsWith("..")) {
      return null;
    }
    return normalized;
  }

  private isLikelyTextBody(data: Buffer): boolean {
    if (data.length === 0) {
      return true;
    }
    const sampleSize = Math.min(data.length, 2048);
    let suspiciousCount = 0;
    for (let index = 0; index < sampleSize; index += 1) {
      const code = data[index];
      const isTab = code === 9;
      const isNewLine = code === 10 || code === 13;
      const isPrintableAscii = code >= 32 && code <= 126;
      if (isTab || isNewLine || isPrintableAscii) {
        continue;
      }
      suspiciousCount += 1;
    }
    return suspiciousCount / sampleSize < 0.2;
  }

  private async pruneOldAutoSaves(directoryPath: string, keepCount: number): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"));
    if (files.length <= keepCount) {
      return;
    }

    const withStats = await Promise.all(
      files.map(async (entry) => {
        const filePath = path.join(directoryPath, entry.name);
        const metadata = await stat(filePath);
        return {
          filePath,
          mtimeMs: metadata.mtimeMs
        };
      })
    );

    withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const toDelete = withStats.slice(keepCount);

    await Promise.all(
      toDelete.map(async (item) => {
        try {
          await unlink(item.filePath);
        } catch (error) {
          log.warn("Failed to remove old temporary auto-save archive.", error);
        }
      })
    );
  }

  private async pickSavePath(range?: { startMs: number; endMs: number } | null): Promise<string> {
    const saveDir = this.captureSettings.defaultSessionSaveDir.trim() || app.getPath("documents");
    const suffix = range
      ? `-range-${Math.round(range.startMs)}ms-${Math.round(range.endMs)}ms`
      : "";
    const defaultPath = path.join(saveDir, this.buildArchiveFileName(suffix));
    const result = await dialog.showSaveDialog({
      title: "Save Tracer Session",
      defaultPath,
      filters: [{ name: "Tracer Session", extensions: ["zip"] }]
    });
    if (result.canceled || !result.filePath) {
      throw new Error("Save canceled by user.");
    }
    return result.filePath.endsWith(".zip") ? result.filePath : `${result.filePath}.zip`;
  }

  private async pickOpenPath(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: "Open Tracer Session",
      properties: ["openFile"],
      filters: [{ name: "Tracer Session", extensions: ["zip"] }]
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) {
      return null;
    }
    return filePath;
  }

  private toSessionRelativePath(filePath: string): string {
    if (!this.sessionRoot) {
      return filePath;
    }
    return toPosixPath(path.relative(this.sessionRoot, filePath));
  }

  private buildArchiveFileName(suffix = ""): string {
    const timestampMs = this.status.captureStartedAt ?? this.status.createdAt ?? Date.now();
    return `${this.formatTimestampForFilename(timestampMs)}${suffix}.zip`;
  }

  private sortEvents(events: CaptureEvent[]): CaptureEvent[] {
    return events.slice().sort((a, b) => {
      if (a.tsMs !== b.tsMs) {
        return a.tsMs - b.tsMs;
      }
      if (a.tRelMs !== b.tRelMs) {
        return a.tRelMs - b.tRelMs;
      }
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" });
    });
  }

  private getTimelineCaptureStartAtMs(): number | null {
    if (!this.status.captureStartedAt) {
      return null;
    }
    return this.status.captureStartedAt + this.pausedAccumulatedMs;
  }

  private consumePausedDuration(): void {
    if (this.pausedStartedAtMs === null) {
      return;
    }
    this.pausedAccumulatedMs += Math.max(0, Date.now() - this.pausedStartedAtMs);
    this.pausedStartedAtMs = null;
  }

  private formatTimestampForFilename(timestampMs: number): string {
    const date = new Date(timestampMs);
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day}_${hours}_${minutes}_${seconds}`;
  }

  private isCapturing(): boolean {
    return this.status.state === "capturing";
  }

  private cloneStatus(): SessionStatus {
    return JSON.parse(JSON.stringify(this.status)) as SessionStatus;
  }

  private recordError(error: unknown, fallbackMessage: string): void {
    const message = error instanceof Error ? error.message : fallbackMessage;
    this.status.lastError = message;
    log.error(fallbackMessage, error);
  }
}
