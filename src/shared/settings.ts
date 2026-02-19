import type { AppSettings } from "./types";

export const MIN_SCREENSHOT_INTERVAL_MS = 250;
export const MAX_SCREENSHOT_INTERVAL_MS = 10000;
export const MIN_LONG_CAPTURE_WARNING_MINUTES = 0;
export const MAX_LONG_CAPTURE_WARNING_MINUTES = 720;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  startUrls: [],
  defaultStartUrl: "",
  defaultSessionSaveDir: "",
  autoSaveOnStopOrClose: true,
  longCaptureWarningMinutes: 30,
  screenshotIntervalMs: 1000,
  fullPageScreenshots: true,
  screenshotOnPageLoad: true,
  screenshotOnConsoleError: true,
  screenshotOnNetworkFail: true
};

const URL_SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:\/\//i;
const LEGACY_BUILT_IN_DEFAULT_START_URL = "https://app.dev.medome.ai";

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toIntervalMs(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_APP_SETTINGS.screenshotIntervalMs;
  }
  return Math.max(
    MIN_SCREENSHOT_INTERVAL_MS,
    Math.min(MAX_SCREENSHOT_INTERVAL_MS, Math.floor(numeric))
  );
}

function toLongCaptureWarningMinutes(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_APP_SETTINGS.longCaptureWarningMinutes;
  }
  return Math.max(
    MIN_LONG_CAPTURE_WARNING_MINUTES,
    Math.min(MAX_LONG_CAPTURE_WARNING_MINUTES, Math.floor(numeric))
  );
}

export function normalizeStartUrlInput(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (URL_SCHEME_PATTERN.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function toStartUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeStartUrlInput(item);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function withLegacyDefaultStartUrl(
  startUrls: string[],
  legacyDefault: unknown,
  hasExplicitStartUrls: boolean
): string[] {
  if (startUrls.length > 0 || hasExplicitStartUrls) {
    return startUrls;
  }

  const normalizedDefault = normalizeStartUrlInput(legacyDefault);
  if (!normalizedDefault) {
    return startUrls;
  }

  // Legacy settings always carried app.dev as implicit default.
  // For migrated users with no explicit list, keep the new UX empty.
  if (normalizedDefault.toLowerCase() === LEGACY_BUILT_IN_DEFAULT_START_URL) {
    return startUrls;
  }

  return [...startUrls, normalizedDefault];
}

function toDefaultStartUrl(value: unknown, startUrls: string[]): string {
  const normalized = normalizeStartUrlInput(value);
  if (normalized) {
    const match = startUrls.find((item) => item.toLowerCase() === normalized.toLowerCase());
    if (match) {
      return match;
    }
  }

  return startUrls[0] ?? DEFAULT_APP_SETTINGS.defaultStartUrl;
}

function toDirectoryPath(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_APP_SETTINGS.defaultSessionSaveDir;
  }
  return value.trim();
}

export function normalizeAppSettings(input: Partial<AppSettings> | null | undefined): AppSettings {
  const hasExplicitStartUrls = Array.isArray(input?.startUrls);
  const normalizedStartUrls = withLegacyDefaultStartUrl(
    toStartUrls(input?.startUrls),
    input?.defaultStartUrl,
    hasExplicitStartUrls
  );

  return {
    startUrls: normalizedStartUrls,
    defaultStartUrl: toDefaultStartUrl(input?.defaultStartUrl, normalizedStartUrls),
    defaultSessionSaveDir: toDirectoryPath(input?.defaultSessionSaveDir),
    autoSaveOnStopOrClose: toBoolean(
      input?.autoSaveOnStopOrClose,
      DEFAULT_APP_SETTINGS.autoSaveOnStopOrClose
    ),
    longCaptureWarningMinutes: toLongCaptureWarningMinutes(input?.longCaptureWarningMinutes),
    screenshotIntervalMs: toIntervalMs(input?.screenshotIntervalMs),
    fullPageScreenshots: toBoolean(
      input?.fullPageScreenshots,
      DEFAULT_APP_SETTINGS.fullPageScreenshots
    ),
    screenshotOnPageLoad: toBoolean(
      input?.screenshotOnPageLoad,
      DEFAULT_APP_SETTINGS.screenshotOnPageLoad
    ),
    screenshotOnConsoleError: toBoolean(
      input?.screenshotOnConsoleError,
      DEFAULT_APP_SETTINGS.screenshotOnConsoleError
    ),
    screenshotOnNetworkFail: toBoolean(
      input?.screenshotOnNetworkFail,
      DEFAULT_APP_SETTINGS.screenshotOnNetworkFail
    )
  };
}
