import { buildManifest, parseManifest } from "./manifest";

describe("manifest", () => {
  it("builds manifest with expected fields", () => {
    const manifest = buildManifest({
      sessionId: "session-1",
      createdAt: 10,
      browserVersion: "Chromium 123",
      appVersion: "0.1.0",
      captureStartedAt: 20,
      captureEndedAt: 30,
      counts: {
        events: 11,
        screenshots: 3,
        networkRequests: 4
      },
      containsBodies: true
    });

    expect(manifest.sessionId).toBe("session-1");
    expect(manifest.browserVersion).toBe("Chromium 123");
    expect(manifest.flags.containsBodies).toBe(true);
    expect(manifest.counts.events).toBe(11);
  });

  it("parses manifest from json", () => {
    const raw = JSON.stringify({
      sessionId: "session-2",
      createdAt: 100,
      browserVersion: "x",
      appVersion: "y",
      captureStartedAt: null,
      captureEndedAt: null,
      counts: {
        events: 0,
        screenshots: 0,
        networkRequests: 0
      },
      flags: {
        containsBodies: false
      }
    });

    const parsed = parseManifest(raw);
    expect(parsed.sessionId).toBe("session-2");
  });
});
