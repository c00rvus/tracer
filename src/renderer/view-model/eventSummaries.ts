import type { CaptureEvent, EventKind } from "../../shared/types";

function truncate(value: string, max = 92): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

export function formatClock(tsMs: number): string {
  return new Date(tsMs).toLocaleTimeString();
}

export function formatRelMs(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${ms}ms`;
}

export function formatRelSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export function eventBadge(event: CaptureEvent): string {
  if (event.kind === "console") {
    if (event.level === "error") {
      return "ERR";
    }
    if (event.level === "warn") {
      return "WRN";
    }
    return "LOG";
  }
  if (event.kind === "network_request") {
    return "REQ";
  }
  if (event.kind === "network_response") {
    return "RES";
  }
  if (event.kind === "network_fail") {
    return "NET";
  }
  if (event.kind === "screenshot") {
    return "IMG";
  }
  return "SYS";
}

export function eventTypeLabel(kind: EventKind): string {
  if (kind === "network_request") {
    return "Request";
  }
  if (kind === "network_response") {
    return "Response";
  }
  if (kind === "network_fail") {
    return "Fail";
  }
  if (kind === "screenshot") {
    return "Screenshot";
  }
  if (kind === "lifecycle") {
    return "Lifecycle";
  }
  return "Console";
}

export function eventTitle(event: CaptureEvent): string {
  if (event.kind === "console") {
    return `Console ${event.level}`;
  }
  if (event.kind === "network_request") {
    return `${event.method} request`;
  }
  if (event.kind === "network_response") {
    return `${event.status} ${event.statusText}`;
  }
  if (event.kind === "network_fail") {
    return "Request failed";
  }
  if (event.kind === "screenshot") {
    return `Screenshot (${event.reason})`;
  }
  return event.action.replaceAll("_", " ");
}

export function eventSubtitle(event: CaptureEvent): string {
  if (event.kind === "console") {
    return truncate(event.text || "console message");
  }
  if (event.kind === "network_request") {
    return truncate(event.url);
  }
  if (event.kind === "network_response") {
    return truncate(`${event.requestId} · ${event.mimeType ?? "unknown mime"}`);
  }
  if (event.kind === "network_fail") {
    return truncate(`${event.url ?? "unknown url"} · ${event.errorText}`);
  }
  if (event.kind === "screenshot") {
    return truncate(event.path);
  }
  return truncate(event.reason ?? "session action");
}
