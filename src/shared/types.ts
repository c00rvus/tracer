export type EventKind =
  | "console"
  | "network_request"
  | "network_response"
  | "network_fail"
  | "screenshot"
  | "lifecycle";

export interface BaseEvent {
  id: string;
  sessionId: string;
  kind: EventKind;
  tsMs: number;
  tRelMs: number;
  pageUrl?: string;
}

export interface ConsoleEvent extends BaseEvent {
  kind: "console";
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  argsJson?: string;
}

export interface NetworkRequestEvent extends BaseEvent {
  kind: "network_request";
  requestId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType?: string;
}

export interface NetworkResponseEvent extends BaseEvent {
  kind: "network_response";
  requestId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  mimeType?: string;
  bodyPath?: string;
}

export interface NetworkFailEvent extends BaseEvent {
  kind: "network_fail";
  requestId: string;
  url?: string;
  errorText: string;
  canceled: boolean;
}

export interface ScreenshotEvent extends BaseEvent {
  kind: "screenshot";
  screenshotId: string;
  path: string;
  width: number;
  height: number;
  reason: "timer" | "load" | "console-error" | "network-fail" | "manual-start";
}

export interface LifecycleEvent extends BaseEvent {
  kind: "lifecycle";
  action: "capture_started" | "capture_paused" | "capture_resumed" | "capture_stopped" | "session_opened";
  reason?: string;
}

export type CaptureEvent =
  | ConsoleEvent
  | NetworkRequestEvent
  | NetworkResponseEvent
  | NetworkFailEvent
  | ScreenshotEvent
  | LifecycleEvent;

export type SessionState =
  | "idle"
  | "browser_ready"
  | "capturing"
  | "paused"
  | "captured"
  | "reviewing";

export interface SessionStatus {
  state: SessionState;
  sessionId: string | null;
  sessionFileName: string | null;
  createdAt: number | null;
  captureStartedAt: number | null;
  captureEndedAt: number | null;
  browserVersion: string | null;
  source: "live" | "archive" | null;
  counts: {
    events: number;
    screenshots: number;
    networkRequests: number;
  };
  lastError: string | null;
}

export interface SessionManifest {
  sessionId: string;
  createdAt: number;
  browserVersion: string;
  appVersion: string;
  captureStartedAt: number | null;
  captureEndedAt: number | null;
  counts: {
    events: number;
    screenshots: number;
    networkRequests: number;
  };
  flags: {
    containsBodies: boolean;
  };
}

export interface SavedSessionResult {
  path: string;
  sessionId: string;
}

export interface SessionExportRange {
  startMs: number;
  endMs: number;
}

export interface SaveSessionOptions {
  range?: SessionExportRange | null;
}

export interface ScreenshotPayload {
  screenshotId: string;
  path: string;
  mimeType: string;
  dataUrl: string;
}

export interface AppSettings {
  startUrls: string[];
  defaultStartUrl: string;
  defaultSessionSaveDir: string;
  autoSaveOnStopOrClose: boolean;
  longCaptureWarningMinutes: number;
  screenshotIntervalMs: number;
  fullPageScreenshots: boolean;
  screenshotOnPageLoad: boolean;
  screenshotOnConsoleError: boolean;
  screenshotOnNetworkFail: boolean;
}
