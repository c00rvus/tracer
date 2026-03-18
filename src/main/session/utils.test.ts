import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CaptureEvent } from "../../shared/types";
import {
  parseEventsNdjson,
  parseEventsNdjsonFile,
  serializeEventLine,
  writeEventsNdjsonFile
} from "./utils";

describe("ndjson", () => {
  it("serializes and parses events", () => {
    const event: CaptureEvent = {
      id: "evt-1",
      sessionId: "session-1",
      kind: "lifecycle",
      tsMs: 100,
      tRelMs: 0,
      action: "capture_started"
    };

    const raw = serializeEventLine(event);
    const parsed = parseEventsNdjson(raw);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: "evt-1",
      kind: "lifecycle",
      action: "capture_started"
    });
  });

  it("streams ndjson files without loading the whole payload into a single string", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tracer-ndjson-"));
    const filePath = path.join(root, "events.ndjson");
    const events: CaptureEvent[] = [
      {
        id: "evt-1",
        sessionId: "session-1",
        kind: "lifecycle",
        tsMs: 100,
        tRelMs: 0,
        action: "capture_started"
      },
      {
        id: "evt-2",
        sessionId: "session-1",
        kind: "lifecycle",
        tsMs: 200,
        tRelMs: 100,
        action: "capture_stopped"
      }
    ];

    try {
      await writeEventsNdjsonFile(filePath, events);
      const raw = await readFile(filePath, "utf8");
      const parsed = await parseEventsNdjsonFile(filePath);

      expect(raw).toContain('"id":"evt-1"');
      expect(parsed).toEqual(events);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
