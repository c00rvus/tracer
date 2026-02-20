import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  nativeImage,
  type NativeImage
} from "electron";
import log from "electron-log";
import type { AppSettings, SaveSessionOptions } from "../shared/types";
import { IPC_CHANNELS } from "./ipcChannels";
import { SettingsStore } from "./settings/SettingsStore";
import { SessionManager } from "./session/SessionManager";

let mainWindow: BrowserWindow | null = null;
let sessionManager: SessionManager | null = null;
let settingsStore: SettingsStore | null = null;
let allowMainWindowClose = false;
let closePromptInFlight = false;
let clearAttentionTimer: NodeJS.Timeout | null = null;

function resolveIconPath(): string {
  return path.join(app.getAppPath(), "build", "icon.png");
}

function emitWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(IPC_CHANNELS.windowStateChanged, {
    isMaximized: mainWindow.isMaximized()
  });
}

function escapeSvgText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildWindowsOverlayBadge(label: string): NativeImage | null {
  if (process.platform !== "win32") {
    return null;
  }
  const text = escapeSvgText(label.trim() || "1");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.35"/>
        </filter>
      </defs>
      <circle cx="32" cy="32" r="28" fill="#f08c00" filter="url(#shadow)"/>
      <text x="32" y="41" text-anchor="middle" fill="#ffffff" font-size="32" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${text}</text>
    </svg>
  `.trim();
  const encoded = Buffer.from(svg, "utf8").toString("base64");
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${encoded}`);
}

function clearWindowAttention(): void {
  if (clearAttentionTimer) {
    clearTimeout(clearAttentionTimer);
    clearAttentionTimer = null;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (process.platform === "win32") {
    mainWindow.flashFrame(false);
    mainWindow.setOverlayIcon(null, "");
  }
}

function triggerWindowAttention(badgeText: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (process.platform === "win32") {
    const overlay = buildWindowsOverlayBadge(badgeText);
    mainWindow.setOverlayIcon(overlay, "Long recording reminder");
    mainWindow.flashFrame(true);
    if (clearAttentionTimer) {
      clearTimeout(clearAttentionTimer);
    }
    clearAttentionTimer = setTimeout(() => {
      clearWindowAttention();
    }, 30000);
  }
}

function requireSessionManager(): SessionManager {
  if (!sessionManager) {
    throw new Error("Session manager is not initialized.");
  }
  return sessionManager;
}

function requireSettingsStore(): SettingsStore {
  if (!settingsStore) {
    throw new Error("Settings store is not initialized.");
  }
  return settingsStore;
}

function registerIpcHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.launchBrowser);
  ipcMain.removeHandler(IPC_CHANNELS.startCapture);
  ipcMain.removeHandler(IPC_CHANNELS.pauseCapture);
  ipcMain.removeHandler(IPC_CHANNELS.resumeCapture);
  ipcMain.removeHandler(IPC_CHANNELS.stopCapture);
  ipcMain.removeHandler(IPC_CHANNELS.save);
  ipcMain.removeHandler(IPC_CHANNELS.open);
  ipcMain.removeHandler(IPC_CHANNELS.getTimeline);
  ipcMain.removeHandler(IPC_CHANNELS.getEvent);
  ipcMain.removeHandler(IPC_CHANNELS.getScreenshot);
  ipcMain.removeHandler(IPC_CHANNELS.getStatus);
  ipcMain.removeHandler(IPC_CHANNELS.getSettings);
  ipcMain.removeHandler(IPC_CHANNELS.updateSettings);
  ipcMain.removeHandler(IPC_CHANNELS.chooseDefaultSaveDirectory);
  ipcMain.removeHandler(IPC_CHANNELS.windowMinimize);
  ipcMain.removeHandler(IPC_CHANNELS.windowToggleMaximize);
  ipcMain.removeHandler(IPC_CHANNELS.windowClose);
  ipcMain.removeHandler(IPC_CHANNELS.windowIsMaximized);
  ipcMain.removeHandler(IPC_CHANNELS.windowNotifyLongCapture);

  ipcMain.handle(IPC_CHANNELS.launchBrowser, async () => requireSessionManager().launchBrowser());
  ipcMain.handle(IPC_CHANNELS.startCapture, async () => requireSessionManager().startCapture());
  ipcMain.handle(IPC_CHANNELS.pauseCapture, async () => requireSessionManager().pauseCapture());
  ipcMain.handle(IPC_CHANNELS.resumeCapture, async () => requireSessionManager().resumeCapture());
  ipcMain.handle(IPC_CHANNELS.stopCapture, async () => requireSessionManager().stopCapture());
  ipcMain.handle(IPC_CHANNELS.save, async (_event, filePath?: string, options?: SaveSessionOptions) =>
    requireSessionManager().save(filePath, options)
  );
  ipcMain.handle(IPC_CHANNELS.open, async (_event, filePath?: string) =>
    requireSessionManager().open(filePath)
  );
  ipcMain.handle(IPC_CHANNELS.getTimeline, async (_event, sessionId: string) =>
    requireSessionManager().getTimeline(sessionId)
  );
  ipcMain.handle(IPC_CHANNELS.getEvent, async (_event, eventId: string) =>
    requireSessionManager().getEvent(eventId)
  );
  ipcMain.handle(IPC_CHANNELS.getScreenshot, async (_event, screenshotId: string) =>
    requireSessionManager().getScreenshot(screenshotId)
  );
  ipcMain.handle(IPC_CHANNELS.getStatus, async () => requireSessionManager().getStatus());
  ipcMain.handle(IPC_CHANNELS.getSettings, async () => requireSettingsStore().get());
  ipcMain.handle(IPC_CHANNELS.updateSettings, async (_event, settings: AppSettings) =>
    requireSettingsStore().update(settings).then((updated) => {
      requireSessionManager().updateSettings(updated);
      return updated;
    })
  );
  ipcMain.handle(IPC_CHANNELS.chooseDefaultSaveDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose Default Session Save Directory",
      properties: ["openDirectory", "createDirectory", "promptToCreate"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
  ipcMain.handle(IPC_CHANNELS.windowMinimize, async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });
  ipcMain.handle(IPC_CHANNELS.windowToggleMaximize, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { isMaximized: false };
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return { isMaximized: mainWindow.isMaximized() };
  });
  ipcMain.handle(IPC_CHANNELS.windowClose, async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });
  ipcMain.handle(IPC_CHANNELS.windowIsMaximized, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { isMaximized: false };
    }
    return { isMaximized: mainWindow.isMaximized() };
  });
  ipcMain.handle(
    IPC_CHANNELS.windowNotifyLongCapture,
    async (
      _event,
      payload?: {
        title?: string;
        body?: string;
        badgeText?: string;
      }
    ) => {
      const title = payload?.title?.trim() || "Long recording reminder";
      const body =
        payload?.body?.trim() ||
        "This session has been recording for a long time. Make sure you don't leave capture running unintentionally.";
      const badgeText = payload?.badgeText?.trim() || "1";

      triggerWindowAttention(badgeText);

      if (Notification.isSupported()) {
        try {
          const notification = new Notification({ title, body });
          notification.show();
        } catch (error) {
          log.warn("Failed to display long recording notification.", error);
        }
      }
    }
  );
}

async function createMainWindow(): Promise<void> {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  allowMainWindowClose = false;
  closePromptInFlight = false;
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    frame: !isWindows,
    thickFrame: isWindows,
    titleBarStyle: isWindows ? "hidden" : isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    backgroundColor: "#13151a",
    icon: isMac ? undefined : resolveIconPath(),
    autoHideMenuBar: isWindows,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    if (process.env.TRACER_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    const rendererPath = path.join(__dirname, "..", "renderer", "index.html");
    await mainWindow.loadFile(rendererPath);
  }

  mainWindow.on("close", (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || allowMainWindowClose) {
      return;
    }

    const currentStatus = sessionManager?.getStatus();
    const captureInProgress =
      currentStatus?.state === "capturing" || currentStatus?.state === "paused";
    if (!captureInProgress) {
      return;
    }

    event.preventDefault();
    if (closePromptInFlight) {
      return;
    }

    closePromptInFlight = true;
    void (async () => {
      try {
        const response = await dialog.showMessageBox(mainWindow!, {
          type: "warning",
          buttons: ["Yes", "No"],
          defaultId: 1,
          cancelId: 1,
          title: "Confirm Close",
          message: "Capture is in progress. Do you really want to close the app?",
          detail: "Choosing Yes will stop and save the current capture before closing."
        });

        if (response.response !== 0) {
          return;
        }

        await requireSessionManager().stopCaptureAndSaveForAppClose();
        allowMainWindowClose = true;
        mainWindow?.close();
      } catch (error) {
        log.error("Failed to stop and save capture before close.", error);
        if (mainWindow && !mainWindow.isDestroyed()) {
          await dialog.showMessageBox(mainWindow, {
            type: "error",
            buttons: ["OK"],
            defaultId: 0,
            cancelId: 0,
            title: "Close failed",
            message: "Failed to stop and save the current capture.",
            detail: error instanceof Error ? error.message : "Unexpected error."
          });
        }
      } finally {
        closePromptInFlight = false;
      }
    })();
  });

  mainWindow.on("closed", () => {
    clearWindowAttention();
    mainWindow = null;
  });
  mainWindow.on("focus", clearWindowAttention);
  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.on("restore", emitWindowState);
  mainWindow.webContents.on("did-finish-load", emitWindowState);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on("before-quit", () => {
  clearWindowAttention();
  if (sessionManager) {
    void sessionManager.dispose();
  }
});

app
  .whenReady()
  .then(async () => {
    settingsStore = new SettingsStore();
    const startupSettings = await settingsStore.load();
    sessionManager = new SessionManager(startupSettings);

    registerIpcHandlers();
    await createMainWindow();
  })
  .catch((error) => {
    log.error("Failed to initialize Electron app.", error);
    app.quit();
  });
