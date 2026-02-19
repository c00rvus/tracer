import type {
  AppSettings,
  CaptureEvent,
  SavedSessionResult,
  ScreenshotPayload,
  SessionStatus
} from "./types";

export interface SessionApi {
  launchBrowser(): Promise<SessionStatus>;
  startCapture(): Promise<SessionStatus>;
  pauseCapture(): Promise<SessionStatus>;
  resumeCapture(): Promise<SessionStatus>;
  stopCapture(): Promise<SessionStatus>;
  save(path?: string): Promise<SavedSessionResult>;
  open(path?: string): Promise<SessionStatus>;
  getTimeline(sessionId: string): Promise<CaptureEvent[]>;
  getEvent(eventId: string): Promise<CaptureEvent | null>;
  getScreenshot(screenshotId: string): Promise<ScreenshotPayload | null>;
  getStatus(): Promise<SessionStatus>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  chooseDefaultSaveDirectory(): Promise<string | null>;
}

export interface WindowState {
  isMaximized: boolean;
}

export type PlatformName = "win32" | "darwin" | "linux";

export interface WindowApi {
  platform: PlatformName;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<WindowState>;
  close(): Promise<void>;
  isMaximized(): Promise<WindowState>;
  onStateChanged(listener: (state: WindowState) => void): () => void;
}

export interface TracerApi {
  session: SessionApi;
  window: WindowApi;
}
