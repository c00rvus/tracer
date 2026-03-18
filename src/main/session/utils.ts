import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { CaptureEvent } from "../../shared/types";

export function stripUtf8Bom(value: string): string {
  return value.replace(/^\uFEFF/u, "");
}

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
  const lines = stripUtf8Bom(raw)
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
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });
  const events: CaptureEvent[] = [];
  let isFirstLine = true;

  try {
    for await (const rawLine of lines) {
      const normalizedLine = (isFirstLine ? stripUtf8Bom(rawLine) : rawLine).trim();
      isFirstLine = false;
      if (normalizedLine.length === 0) {
        continue;
      }
      events.push(JSON.parse(normalizedLine) as CaptureEvent);
    }
    return events;
  } finally {
    lines.close();
    stream.close();
  }
}

export async function writeEventsNdjsonFile(
  filePath: string,
  events: Iterable<CaptureEvent>
): Promise<void> {
  const stream = createWriteStream(filePath, {
    flags: "w",
    encoding: "utf8"
  });

  try {
    for (const event of events) {
      if (!stream.write(serializeEventLine(event))) {
        await once(stream, "drain");
      }
    }

    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on("error", (error) => reject(error));
    });
  } catch (error) {
    stream.destroy();
    throw error;
  }
}
