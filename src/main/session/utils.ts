import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CaptureEvent } from "../../shared/types";

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export function sanitizeFileFragment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function serializeEventLine(event: CaptureEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseEventsNdjson(raw: string): CaptureEvent[] {
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const events: CaptureEvent[] = [];
  for (const line of lines) {
    events.push(JSON.parse(line) as CaptureEvent);
  }
  return events;
}

export async function parseEventsNdjsonFile(filePath: string): Promise<CaptureEvent[]> {
  const raw = await readFile(filePath, "utf8");
  return parseEventsNdjson(raw);
}
