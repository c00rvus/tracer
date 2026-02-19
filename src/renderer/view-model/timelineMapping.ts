import type { CaptureEvent } from "../../shared/types";
import { eventBadge, eventSubtitle, eventTitle, formatRelSeconds } from "./eventSummaries";
import type { EventRowViewModel } from "./types";

export type ActionFilterKind = Exclude<CaptureEvent["kind"], "screenshot"> | "errors";

export const ACTION_FILTER_OPTIONS: ActionFilterKind[] = [
  "errors",
  "console",
  "network_request",
  "network_response",
  "network_fail",
  "lifecycle"
];

export function compareCaptureEvents(a: CaptureEvent, b: CaptureEvent): number {
  if (a.tsMs !== b.tsMs) {
    return a.tsMs - b.tsMs;
  }
  if (a.tRelMs !== b.tRelMs) {
    return a.tRelMs - b.tRelMs;
  }
  return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" });
}

export function sortTimeline(events: CaptureEvent[]): CaptureEvent[] {
  return events.slice().sort(compareCaptureEvents);
}

function getRequestId(event: CaptureEvent): string | null {
  if (
    event.kind === "network_request" ||
    event.kind === "network_response" ||
    event.kind === "network_fail"
  ) {
    return event.requestId;
  }
  return null;
}

export function toEventRows(events: CaptureEvent[]): EventRowViewModel[] {
  return events.map((event, index) => {
    const prev = events[index - 1];
    const next = events[index + 1];
    const durationMs = next ? Math.max(0, next.tRelMs - event.tRelMs) : prev ? Math.max(0, event.tRelMs - prev.tRelMs) : 0;
    return {
      id: event.id,
      event,
      kind: event.kind,
      badge: eventBadge(event),
      title: eventTitle(event),
      subtitle: eventSubtitle(event),
      deltaMs: prev ? Math.max(0, event.tRelMs - prev.tRelMs) : 0,
      durationMs,
      relMs: event.tRelMs,
      clockLabel: formatRelSeconds(event.tRelMs)
    };
  });
}

export function filterEventRows(
  rows: EventRowViewModel[],
  search: string,
  selectedKinds: ActionFilterKind[]
): EventRowViewModel[] {
  const query = search.trim().toLowerCase();
  const allowedKinds = new Set<ActionFilterKind>(selectedKinds);
  return rows.filter((row) => {
    if (row.kind === "screenshot") {
      return false;
    }
    const isErrorRow =
      row.event.kind === "network_fail" ||
      (row.event.kind === "console" && row.event.level === "error");
    const kindSelected =
      allowedKinds.has(row.kind as ActionFilterKind) || (allowedKinds.has("errors") && isErrorRow);
    if (!kindSelected) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = `${row.title} ${row.subtitle} ${JSON.stringify(row.event)}`.toLowerCase();
    return haystack.includes(query);
  });
}

export function getWindowByIndex(
  events: CaptureEvent[],
  selectedIndex: number,
  radius: number
): CaptureEvent[] {
  if (selectedIndex < 0 || events.length === 0) {
    return [];
  }
  const start = Math.max(0, selectedIndex - radius);
  const end = Math.min(events.length, selectedIndex + radius + 1);
  return events.slice(start, end);
}

export function getWindowByTime(
  events: CaptureEvent[],
  centerTsMs: number,
  radiusMs: number
): CaptureEvent[] {
  if (!Number.isFinite(centerTsMs)) {
    return [];
  }
  return events
    .filter((event) => Math.abs(event.tsMs - centerTsMs) <= radiusMs)
    .sort(compareCaptureEvents);
}

export function getErrorsAroundEvent(events: CaptureEvent[], centerTsMs: number): CaptureEvent[] {
  return getWindowByTime(events, centerTsMs, 5000).filter((event) => {
    if (event.kind === "network_fail") {
      return true;
    }
    return event.kind === "console" && event.level === "error";
  });
}

export function getConsoleAroundEvent(events: CaptureEvent[], centerTsMs: number): CaptureEvent[] {
  return getWindowByTime(events, centerTsMs, 5000).filter((event) => event.kind === "console");
}

export function buildRequestMap(events: CaptureEvent[]): Map<string, CaptureEvent[]> {
  const map = new Map<string, CaptureEvent[]>();
  for (const event of events) {
    const requestId = getRequestId(event);
    if (!requestId) {
      continue;
    }
    const items = map.get(requestId) ?? [];
    items.push(event);
    map.set(requestId, items);
  }
  for (const items of map.values()) {
    items.sort(compareCaptureEvents);
  }
  return map;
}

export function getRequestIdFromEvent(event: CaptureEvent | null): string | null {
  if (!event) {
    return null;
  }
  return getRequestId(event);
}

export function getNetworkAroundEvent(events: CaptureEvent[], centerTsMs: number): CaptureEvent[] {
  return getWindowByTime(events, centerTsMs, 5000).filter((event) => {
    return (
      event.kind === "network_request" ||
      event.kind === "network_response" ||
      event.kind === "network_fail"
    );
  });
}
