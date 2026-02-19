import { randomUUID } from "node:crypto";
import type { BaseEvent, EventKind } from "../../shared/types";

interface BaseEventOptions {
  sessionId: string;
  captureStartAtMs: number;
  kind: EventKind;
  pageUrl?: string;
  nowMs?: number;
}

export function createBaseEvent(options: BaseEventOptions): BaseEvent {
  const tsMs = options.nowMs ?? Date.now();
  return {
    id: randomUUID(),
    sessionId: options.sessionId,
    kind: options.kind,
    tsMs,
    tRelMs: Math.max(0, tsMs - options.captureStartAtMs),
    pageUrl: options.pageUrl
  };
}

export function normalizeConsoleLevel(
  rawLevel: string
): "log" | "info" | "warn" | "error" | "debug" {
  if (rawLevel === "warning") {
    return "warn";
  }
  if (rawLevel === "verbose") {
    return "debug";
  }
  if (rawLevel === "log" || rawLevel === "info" || rawLevel === "warn" || rawLevel === "error" || rawLevel === "debug") {
    return rawLevel;
  }
  return "log";
}
