import type { CaptureEvent, ConsoleEvent } from "../../shared/types";
import { eventBadge, eventSubtitle, eventTitle, formatRelSeconds } from "./eventSummaries";
import type { EventRowViewModel } from "./types";

export type ActionFilterKind = Exclude<CaptureEvent["kind"], "screenshot"> | "errors";
export type ConsoleLevelFilter = ConsoleEvent["level"];
export type ActionHttpMethodFilter =
  | "all"
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export interface ActionRowFilters {
  search: string;
  selectedKinds: ActionFilterKind[];
  caseSensitive: boolean;
  regexSearch: boolean;
  urlContains: string;
  requestIdContains: string;
  method: ActionHttpMethodFilter;
  statusMin: number | null;
  statusMax: number | null;
  relStartMs: number | null;
  relEndMs: number | null;
  hideStaticAssets: boolean;
  onlyErrors: boolean;
  consoleLevels: ConsoleLevelFilter[];
}

export const ACTION_FILTER_OPTIONS: ActionFilterKind[] = [
  "errors",
  "console",
  "network_request",
  "network_response",
  "network_fail",
  "lifecycle"
];

export const CONSOLE_LEVEL_FILTER_OPTIONS: ConsoleLevelFilter[] = [
  "log",
  "info",
  "warn",
  "error",
  "debug"
];

export const ACTION_HTTP_METHOD_FILTER_OPTIONS: ActionHttpMethodFilter[] = [
  "all",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD"
];

const STATIC_ASSET_URL_PATTERN =
  /\.(?:avif|bmp|css|eot|gif|ico|jpe?g|js|json|map|mjs|otf|png|svg|ttf|webp|woff2?|mp4|webm|mp3|wav)(?:[?#]|$)/i;
const STATIC_RESOURCE_TYPES = new Set(["Image", "Stylesheet", "Script", "Font", "Media", "Manifest"]);
const STATIC_MIME_PATTERN =
  /^(image\/|font\/|audio\/|video\/|text\/css|text\/javascript|application\/javascript|application\/x-javascript)/i;

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

function isErrorEvent(event: CaptureEvent): boolean {
  return event.kind === "network_fail" || (event.kind === "console" && event.level === "error");
}

function normalizeForSearch(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

function includesText(value: string, query: string, caseSensitive: boolean): boolean {
  if (!query) {
    return true;
  }
  const normalizedValue = normalizeForSearch(value, caseSensitive);
  const normalizedQuery = normalizeForSearch(query, caseSensitive);
  return normalizedValue.includes(normalizedQuery);
}

function parseRequestInfo(
  rows: EventRowViewModel[]
): {
  methodByRequestId: Map<string, string>;
  urlByRequestId: Map<string, string>;
} {
  const methodByRequestId = new Map<string, string>();
  const urlByRequestId = new Map<string, string>();

  for (const row of rows) {
    if (row.event.kind !== "network_request") {
      continue;
    }
    methodByRequestId.set(row.event.requestId, row.event.method.toUpperCase());
    urlByRequestId.set(row.event.requestId, row.event.url);
  }

  return {
    methodByRequestId,
    urlByRequestId
  };
}

function getEventUrl(event: CaptureEvent, urlByRequestId: Map<string, string>): string {
  if (event.kind === "network_request") {
    return event.url;
  }
  if (event.kind === "network_response") {
    return urlByRequestId.get(event.requestId) ?? "";
  }
  if (event.kind === "network_fail") {
    return event.url ?? urlByRequestId.get(event.requestId) ?? "";
  }
  return event.pageUrl ?? "";
}

function getEventMethod(event: CaptureEvent, methodByRequestId: Map<string, string>): string {
  if (event.kind === "network_request") {
    return event.method.toUpperCase();
  }
  if (event.kind === "network_response" || event.kind === "network_fail") {
    return methodByRequestId.get(event.requestId) ?? "";
  }
  return "";
}

function isStaticAssetEvent(event: CaptureEvent, urlByRequestId: Map<string, string>): boolean {
  if (
    event.kind !== "network_request" &&
    event.kind !== "network_response" &&
    event.kind !== "network_fail"
  ) {
    return false;
  }

  const url = getEventUrl(event, urlByRequestId);
  if (url && STATIC_ASSET_URL_PATTERN.test(url)) {
    return true;
  }

  if (event.kind === "network_request") {
    if (event.resourceType && STATIC_RESOURCE_TYPES.has(event.resourceType)) {
      return true;
    }
    return false;
  }

  if (event.kind === "network_response") {
    if (event.mimeType && STATIC_MIME_PATTERN.test(event.mimeType)) {
      return true;
    }
    return false;
  }

  return false;
}

export function toEventRows(events: CaptureEvent[]): EventRowViewModel[] {
  return events.map((event, index) => {
    const prev = events[index - 1];
    const next = events[index + 1];
    const badge = eventBadge(event);
    const title = eventTitle(event);
    const subtitle = eventSubtitle(event);
    const durationMs = next
      ? Math.max(0, next.tRelMs - event.tRelMs)
      : prev
        ? Math.max(0, event.tRelMs - prev.tRelMs)
        : 0;

    return {
      id: event.id,
      event,
      kind: event.kind,
      badge,
      title,
      subtitle,
      searchText: `${title} ${subtitle} ${JSON.stringify(event)}`,
      deltaMs: prev ? Math.max(0, event.tRelMs - prev.tRelMs) : 0,
      durationMs,
      relMs: event.tRelMs,
      clockLabel: formatRelSeconds(event.tRelMs)
    };
  });
}

export function filterEventRows(
  rows: EventRowViewModel[],
  filters: ActionRowFilters
): EventRowViewModel[] {
  const query = filters.search.trim();
  const urlQuery = filters.urlContains.trim();
  const requestIdQuery = filters.requestIdContains.trim();
  const hasStatusFilter = filters.statusMin !== null || filters.statusMax !== null;
  const hasTimeFilter = filters.relStartMs !== null || filters.relEndMs !== null;
  const allowedKinds = new Set<ActionFilterKind>(filters.selectedKinds);
  const allowedConsoleLevels = new Set<ConsoleLevelFilter>(filters.consoleLevels);
  const { methodByRequestId, urlByRequestId } = parseRequestInfo(rows);

  let searchRegex: RegExp | null = null;
  if (filters.regexSearch && query) {
    try {
      searchRegex = new RegExp(query, filters.caseSensitive ? "" : "i");
    } catch {
      searchRegex = null;
    }
  }

  return rows.filter((row) => {
    if (row.kind === "screenshot") {
      return false;
    }

    const isErrorRow = isErrorEvent(row.event);
    const kindSelected =
      allowedKinds.has(row.kind as ActionFilterKind) || (allowedKinds.has("errors") && isErrorRow);
    if (!kindSelected) {
      return false;
    }

    if (filters.onlyErrors && !isErrorRow) {
      return false;
    }

    if (row.event.kind === "console" && !allowedConsoleLevels.has(row.event.level)) {
      return false;
    }

    if (filters.method !== "all") {
      const eventMethod = getEventMethod(row.event, methodByRequestId);
      if (!eventMethod || eventMethod !== filters.method) {
        return false;
      }
    }

    if (hasStatusFilter) {
      if (row.event.kind !== "network_response") {
        return false;
      }
      if (filters.statusMin !== null && row.event.status < filters.statusMin) {
        return false;
      }
      if (filters.statusMax !== null && row.event.status > filters.statusMax) {
        return false;
      }
    }

    if (hasTimeFilter) {
      if (filters.relStartMs !== null && row.relMs < filters.relStartMs) {
        return false;
      }
      if (filters.relEndMs !== null && row.relMs > filters.relEndMs) {
        return false;
      }
    }

    if (filters.hideStaticAssets && isStaticAssetEvent(row.event, urlByRequestId)) {
      return false;
    }

    if (urlQuery) {
      const eventUrl = getEventUrl(row.event, urlByRequestId);
      if (!includesText(eventUrl, urlQuery, filters.caseSensitive)) {
        return false;
      }
    }

    if (requestIdQuery) {
      const requestId = getRequestId(row.event) ?? "";
      if (!includesText(requestId, requestIdQuery, filters.caseSensitive)) {
        return false;
      }
    }

    if (!query) {
      return true;
    }

    if (searchRegex) {
      return searchRegex.test(row.searchText);
    }

    return includesText(row.searchText, query, filters.caseSensitive);
  });
}

function lowerBoundByTimestamp(events: CaptureEvent[], targetTsMs: number): number {
  let low = 0;
  let high = events.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (events[mid].tsMs < targetTsMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function upperBoundByTimestamp(events: CaptureEvent[], targetTsMs: number): number {
  let low = 0;
  let high = events.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (events[mid].tsMs <= targetTsMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
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

  const startIndex = lowerBoundByTimestamp(events, centerTsMs - radiusMs);
  const endIndex = upperBoundByTimestamp(events, centerTsMs + radiusMs);
  return events.slice(startIndex, endIndex);
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
