import type {
  AppSettings,
  CaptureEvent,
  ExportedVideoResult,
  ExportVideoOptions,
  NetworkBodyPayload,
  SaveSessionOptions,
  SavedSessionResult,
  ScreenshotPayload,
  SessionStatus,
  SessionExportRange,
  TimelineDeltaPayload
} from "./types";

export interface SessionApi {
  launchBrowser(): Promise<SessionStatus>;
  startCapture(): Promise<SessionStatus>;
  pauseCapture(): Promise<SessionStatus>;
  resumeCapture(): Promise<SessionStatus>;
  stopCapture(): Promise<SessionStatus>;
  save(path?: string, options?: SaveSessionOptions): Promise<SavedSessionResult>;
  open(path?: string): Promise<SessionStatus>;
  chooseImportFile(): Promise<string | null>;
  chooseVideoExportPath(range?: SessionExportRange | null): Promise<string | null>;
  exportVideo(path: string, options?: ExportVideoOptions): Promise<ExportedVideoResult>;
  getTimeline(sessionId: string): Promise<CaptureEvent[]>;
  getTimelineDelta(sessionId: string, cursor: number): Promise<TimelineDeltaPayload>;
  getEvent(eventId: string): Promise<CaptureEvent | null>;
  getScreenshot(
    screenshotId: string,
    variant?: "thumbnail" | "full"
  ): Promise<ScreenshotPayload | null>;
  getNetworkBody(bodyPath: string): Promise<NetworkBodyPayload | null>;
  getStatus(): Promise<SessionStatus>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  chooseDefaultSaveDirectory(): Promise<string | null>;
}

export interface WindowState {
  isMaximized: boolean;
}

export type PlatformName = "win32" | "darwin" | "linux";

export interface LongCaptureNotificationPayload {
  title?: string;
  body?: string;
  badgeText?: string;
}

export interface WindowApi {
  platform: PlatformName;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<WindowState>;
  close(): Promise<void>;
  isMaximized(): Promise<WindowState>;
  notifyLongCapture(payload?: LongCaptureNotificationPayload): Promise<void>;
  onStateChanged(listener: (state: WindowState) => void): () => void;
}

export interface TracerApi {
  session: SessionApi;
  window: WindowApi;
}
