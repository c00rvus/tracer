import { createBaseEvent, normalizeConsoleLevel } from "./eventFactory";

describe("eventFactory", () => {
  it("creates base event with relative timestamp", () => {
    const event = createBaseEvent({
      sessionId: "session-1",
      captureStartAtMs: 1000,
      kind: "console",
      nowMs: 1450,
      pageUrl: "https://example.com"
    });

    expect(event.sessionId).toBe("session-1");
    expect(event.kind).toBe("console");
    expect(event.tsMs).toBe(1450);
    expect(event.tRelMs).toBe(450);
    expect(event.pageUrl).toBe("https://example.com");
    expect(event.id.length).toBeGreaterThan(0);
  });

  it("normalizes console levels from playwright values", () => {
    expect(normalizeConsoleLevel("warning")).toBe("warn");
    expect(normalizeConsoleLevel("verbose")).toBe("debug");
    expect(normalizeConsoleLevel("error")).toBe("error");
    expect(normalizeConsoleLevel("unknown")).toBe("log");
  });
});
