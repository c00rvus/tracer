import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { rm, writeFile } from "node:fs/promises";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import type { CaptureEvent, ExportedVideoResult, ScreenshotEvent, SessionExportRange } from "../../shared/types";
import { ensureDir } from "../session/utils";

const DEFAULT_LAST_FRAME_DURATION_MS = 1000;
const MIN_FRAME_DURATION_MS = 50;
const MAX_VIDEO_WIDTH_PX = 1920;
const MAX_VIDEO_HEIGHT_PX = 1080;

export interface PlannedVideoFrame {
  screenshotId: string;
  path: string;
  durationMs: number;
  width: number;
  height: number;
  tRelMs: number;
}

export interface VideoExportPlan {
  frames: PlannedVideoFrame[];
  width: number;
  height: number;
  range: SessionExportRange;
  durationMs: number;
}

interface ExportSessionVideoInput {
  events: CaptureEvent[];
  outputPath: string;
  tempRoot: string;
  sessionId: string;
  range?: SessionExportRange | null;
  resolveScreenshotPath: (relativePath: string) => string;
}

function isScreenshotEvent(event: CaptureEvent): event is ScreenshotEvent {
  return event.kind === "screenshot";
}

function toEvenDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function fitWithinBounds(width: number, height: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 1280, height: 720 };
  }

  const scale = Math.min(1, MAX_VIDEO_WIDTH_PX / width, MAX_VIDEO_HEIGHT_PX / height);
  return {
    width: toEvenDimension(width * scale),
    height: toEvenDimension(height * scale)
  };
}

function resolveTailDurationMs(screenshots: ScreenshotEvent[]): number {
  if (screenshots.length < 2) {
    return DEFAULT_LAST_FRAME_DURATION_MS;
  }

  const last = screenshots[screenshots.length - 1];
  const previous = screenshots[screenshots.length - 2];
  const inferred = Math.max(MIN_FRAME_DURATION_MS, last.tRelMs - previous.tRelMs);
  return inferred;
}

function normalizeRangeForVideo(
  events: CaptureEvent[],
  screenshots: ScreenshotEvent[],
  range?: SessionExportRange | null
): SessionExportRange {
  if (screenshots.length === 0) {
    throw new Error("No screenshots are available to export a video.");
  }

  if (range) {
    const startMs = Math.min(range.startMs, range.endMs);
    const endMs = Math.max(range.startMs, range.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new Error("Invalid video export range.");
    }
    if (endMs <= startMs) {
      throw new Error("Selected video range is empty.");
    }
    return { startMs, endMs };
  }

  const firstScreenshot = screenshots[0];
  const lastScreenshot = screenshots[screenshots.length - 1];
  const lastEvent = events[events.length - 1];
  const tailDurationMs = resolveTailDurationMs(screenshots);
  const endMs = Math.max(lastEvent?.tRelMs ?? 0, lastScreenshot.tRelMs + tailDurationMs);

  return {
    startMs: firstScreenshot.tRelMs,
    endMs
  };
}

function findLastScreenshotAtOrBefore(
  screenshots: ScreenshotEvent[],
  tRelMs: number
): ScreenshotEvent | null {
  for (let index = screenshots.length - 1; index >= 0; index -= 1) {
    const screenshot = screenshots[index];
    if (screenshot.tRelMs <= tRelMs) {
      return screenshot;
    }
  }
  return null;
}

export function buildVideoExportPlan(
  events: CaptureEvent[],
  range?: SessionExportRange | null
): VideoExportPlan {
  const screenshots = events.filter(isScreenshotEvent);
  if (screenshots.length === 0) {
    throw new Error("No screenshots are available to export a video.");
  }

  const normalizedRange = normalizeRangeForVideo(events, screenshots, range);
  const initialFrame =
    findLastScreenshotAtOrBefore(screenshots, normalizedRange.startMs) ??
    screenshots.find((event) => event.tRelMs >= normalizedRange.startMs) ??
    screenshots[screenshots.length - 1];

  if (!initialFrame) {
    throw new Error("No screenshots are available to build the video timeline.");
  }

  const futureFrames = screenshots.filter(
    (event) => event.tRelMs > normalizedRange.startMs && event.tRelMs <= normalizedRange.endMs
  );

  const plannedFrames: PlannedVideoFrame[] = [];
  let currentFrame = initialFrame;
  let cursorMs = normalizedRange.startMs;

  const pushFrame = (frame: ScreenshotEvent, durationMs: number) => {
    if (durationMs < MIN_FRAME_DURATION_MS) {
      return;
    }
    plannedFrames.push({
      screenshotId: frame.screenshotId,
      path: frame.path,
      durationMs,
      width: frame.width,
      height: frame.height,
      tRelMs: frame.tRelMs
    });
  };

  for (const nextFrame of futureFrames) {
    const nextBoundaryMs = Math.min(normalizedRange.endMs, nextFrame.tRelMs);
    pushFrame(currentFrame, nextBoundaryMs - cursorMs);
    currentFrame = nextFrame;
    cursorMs = nextBoundaryMs;
  }

  pushFrame(currentFrame, normalizedRange.endMs - cursorMs);

  if (plannedFrames.length === 0) {
    throw new Error("Selected range is too short to export a video.");
  }

  const sizeStats = new Map<string, { width: number; height: number; count: number }>();
  for (const frame of plannedFrames) {
    const key = `${frame.width}x${frame.height}`;
    const existing = sizeStats.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    sizeStats.set(key, {
      width: frame.width,
      height: frame.height,
      count: 1
    });
  }

  const preferredSize =
    Array.from(sizeStats.values()).sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }
      return right.width * right.height - left.width * left.height;
    })[0] ?? {
      width: 1280,
      height: 720,
      count: 1
    };

  const canvas = fitWithinBounds(preferredSize.width, preferredSize.height);

  return {
    frames: plannedFrames,
    width: canvas.width,
    height: canvas.height,
    range: normalizedRange,
    durationMs: normalizedRange.endMs - normalizedRange.startMs
  };
}

export function buildConcatInputFileContent(frames: Array<{ absolutePath: string; durationMs: number }>): string {
  if (frames.length === 0) {
    throw new Error("Cannot build a concat input file without frames.");
  }

  const lines: string[] = [];
  for (const frame of frames) {
    const escapedPath = frame.absolutePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
    lines.push(`file '${escapedPath}'`);
    lines.push(`duration ${(frame.durationMs / 1000).toFixed(3)}`);
  }
  const lastFramePath = frames[frames.length - 1].absolutePath
    .replace(/\\/g, "/")
    .replace(/'/g, "'\\''");
  lines.push(`file '${lastFramePath}'`);
  return `${lines.join("\n")}\n`;
}

function resolveEmbeddedFfmpegPath(): string {
  const resolvedPath = ffmpegInstaller.path?.replace(/app\.asar/gu, "app.asar.unpacked");
  if (!resolvedPath) {
    throw new Error("Embedded ffmpeg binary is unavailable in this build.");
  }
  return resolvedPath;
}

async function runFfmpeg(args: string[]): Promise<void> {
  const binaryPath = resolveEmbeddedFfmpegPath();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(stderr.trim() || `ffmpeg exited with code ${code ?? "unknown"}.`)
      );
    });
  });
}

async function encodeVideo(
  concatFilePath: string,
  outputPath: string,
  width: number,
  height: number
): Promise<void> {
  const videoFilter = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "format=yuv420p"
  ].join(",");

  const commonArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFilePath,
    "-vf",
    videoFilter,
    "-an",
    "-movflags",
    "+faststart"
  ];

  try {
    await runFfmpeg([
      ...commonArgs,
      "-vsync",
      "vfr",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      outputPath
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ffmpeg export failed.";
    if (!message.toLowerCase().includes("unknown encoder")) {
      throw error;
    }

    await runFfmpeg([
      ...commonArgs,
      "-vsync",
      "vfr",
      "-c:v",
      "mpeg4",
      "-q:v",
      "5",
      outputPath
    ]);
  }
}

export async function exportSessionVideo({
  events,
  outputPath,
  tempRoot,
  sessionId,
  range,
  resolveScreenshotPath
}: ExportSessionVideoInput): Promise<ExportedVideoResult> {
  const plan = buildVideoExportPlan(events, range);
  const frameInputs = plan.frames.map((frame) => ({
    absolutePath: resolveScreenshotPath(frame.path),
    durationMs: frame.durationMs
  }));

  const workRoot = path.join(tempRoot, "tracer-video-export", randomUUID());
  const concatFilePath = path.join(workRoot, "frames.txt");

  await ensureDir(path.dirname(outputPath));
  await ensureDir(workRoot);

  try {
    await writeFile(concatFilePath, buildConcatInputFileContent(frameInputs), "utf8");
    await encodeVideo(concatFilePath, outputPath, plan.width, plan.height);
    return {
      path: outputPath,
      sessionId,
      frameCount: plan.frames.length,
      durationMs: plan.durationMs
    };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}
