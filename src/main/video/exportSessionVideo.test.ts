import { describe, expect, it } from "vitest";
import type { CaptureEvent, LifecycleEvent, ScreenshotEvent } from "../../shared/types";
import { buildConcatInputFileContent, buildVideoExportPlan } from "./exportSessionVideo";

function createScreenshotEvent(
  overrides: Partial<ScreenshotEvent> & Pick<ScreenshotEvent, "id" | "screenshotId" | "tRelMs" | "path">
): ScreenshotEvent {
  return {
    id: overrides.id,
    sessionId: "session-1",
    kind: "screenshot",
    tsMs: 1_700_000_000_000 + overrides.tRelMs,
    tRelMs: overrides.tRelMs,
    screenshotId: overrides.screenshotId,
    path: overrides.path,
    width: overrides.width ?? 1279,
    height: overrides.height ?? 719,
    reason: overrides.reason ?? "timer",
    pageUrl: overrides.pageUrl
  };
}

function createLifecycleEvent(
  overrides: Partial<LifecycleEvent> & Pick<LifecycleEvent, "id" | "tRelMs" | "action">
): LifecycleEvent {
  return {
    id: overrides.id,
    sessionId: "session-1",
    kind: "lifecycle",
    tsMs: 1_700_000_000_000 + overrides.tRelMs,
    tRelMs: overrides.tRelMs,
    action: overrides.action,
    reason: overrides.reason,
    pageUrl: overrides.pageUrl
  };
}

describe("exportSessionVideo", () => {
  it("builds a full-session video plan using the last event as the end boundary", () => {
    const events: CaptureEvent[] = [
      createScreenshotEvent({
        id: "shot-1",
        screenshotId: "shot-1",
        tRelMs: 0,
        path: "screenshots/shot-1.png",
        width: 1279,
        height: 719
      }),
      createScreenshotEvent({
        id: "shot-2",
        screenshotId: "shot-2",
        tRelMs: 1200,
        path: "screenshots/shot-2.png",
        width: 1200,
        height: 700
      }),
      createLifecycleEvent({
        id: "stop",
        tRelMs: 2200,
        action: "capture_stopped"
      })
    ];

    const plan = buildVideoExportPlan(events);

    expect(plan.range).toEqual({ startMs: 0, endMs: 2400 });
    expect(plan.durationMs).toBe(2400);
    expect(plan.width).toBe(1280);
    expect(plan.height).toBe(720);
    expect(plan.frames).toEqual([
      expect.objectContaining({
        screenshotId: "shot-1",
        durationMs: 1200
      }),
      expect.objectContaining({
        screenshotId: "shot-2",
        durationMs: 1200
      })
    ]);
  });

  it("builds a range video plan starting from the latest screenshot before the range", () => {
    const events: CaptureEvent[] = [
      createScreenshotEvent({
        id: "shot-1",
        screenshotId: "shot-1",
        tRelMs: 100,
        path: "screenshots/shot-1.png"
      }),
      createScreenshotEvent({
        id: "shot-2",
        screenshotId: "shot-2",
        tRelMs: 500,
        path: "screenshots/shot-2.png"
      }),
      createScreenshotEvent({
        id: "shot-3",
        screenshotId: "shot-3",
        tRelMs: 900,
        path: "screenshots/shot-3.png"
      }),
      createLifecycleEvent({
        id: "stop",
        tRelMs: 1200,
        action: "capture_stopped"
      })
    ];

    const plan = buildVideoExportPlan(events, { startMs: 600, endMs: 1000 });

    expect(plan.frames).toEqual([
      expect.objectContaining({
        screenshotId: "shot-2",
        durationMs: 300
      }),
      expect.objectContaining({
        screenshotId: "shot-3",
        durationMs: 100
      })
    ]);
  });

  it("builds concat input content with escaped absolute paths and repeated last frame", () => {
    const content = buildConcatInputFileContent([
      {
        absolutePath: "C:\\shots\\we're-1.png",
        durationMs: 500
      },
      {
        absolutePath: "C:\\shots\\frame-2.png",
        durationMs: 1250
      }
    ]);

    expect(content).toContain("file 'C:/shots/we'\\''re-1.png'");
    expect(content).toContain("duration 0.500");
    expect(content).toContain("duration 1.250");
    expect(content.trim().endsWith("file 'C:/shots/frame-2.png'")).toBe(true);
  });
});
