import type { SessionManifest, SessionStatus } from "../../shared/types";

interface BuildManifestInput {
  sessionId: string;
  createdAt: number;
  browserVersion: string | null;
  appVersion: string;
  captureStartedAt: number | null;
  captureEndedAt: number | null;
  counts: SessionStatus["counts"];
  containsBodies: boolean;
}

export function buildManifest(input: BuildManifestInput): SessionManifest {
  return {
    sessionId: input.sessionId,
    createdAt: input.createdAt,
    browserVersion: input.browserVersion ?? "unknown",
    appVersion: input.appVersion,
    captureStartedAt: input.captureStartedAt,
    captureEndedAt: input.captureEndedAt,
    counts: {
      events: input.counts.events,
      screenshots: input.counts.screenshots,
      networkRequests: input.counts.networkRequests
    },
    flags: {
      containsBodies: input.containsBodies
    }
  };
}

export function parseManifest(raw: string): SessionManifest {
  const parsed = JSON.parse(raw) as Partial<SessionManifest>;
  if (!parsed.sessionId || typeof parsed.createdAt !== "number") {
    throw new Error("Invalid session manifest.");
  }
  return parsed as SessionManifest;
}
