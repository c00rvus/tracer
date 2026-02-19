import type { CaptureEvent } from "../../shared/types";
import { parseEventsNdjson, serializeEventLine } from "./utils";

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
});
