import type { CaptureEvent } from "../../shared/types";
import { getWindowByTime, toEventRows } from "./timelineMapping";

describe("timelineMapping", () => {
  it("builds reusable search text once per row", () => {
    const event: CaptureEvent = {
      id: "evt-1",
      sessionId: "session-1",
      kind: "console",
      tsMs: 1000,
      tRelMs: 250,
      level: "error",
      text: "Request failed"
    };

    const [row] = toEventRows([event]);

    expect(row.searchText).toContain("Request failed");
    expect(row.searchText).toContain('"kind":"console"');
  });

  it("returns a time window using timeline order without rescanning the full array", () => {
    const events: CaptureEvent[] = Array.from({ length: 6 }, (_, index) => ({
      id: `evt-${index}`,
      sessionId: "session-1",
      kind: "lifecycle",
      tsMs: 1000 + index * 100,
      tRelMs: index * 100,
      action: "capture_started"
    }));

    const windowEvents = getWindowByTime(events, 1250, 120);

    expect(windowEvents.map((event) => event.id)).toEqual(["evt-2", "evt-3"]);
  });
});
