import type { CaptureEvent, ScreenshotEvent } from "../../shared/types";

interface ScreenshotContext {
  current: ScreenshotEvent | null;
  before: ScreenshotEvent | null;
  after: ScreenshotEvent | null;
}

function findIndexById(frames: ScreenshotEvent[], eventId: string): number {
  return frames.findIndex((frame) => frame.id === eventId);
}

function nearestAtOrBefore(frames: ScreenshotEvent[], tsMs: number): ScreenshotEvent | null {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (frames[index].tsMs <= tsMs) {
      return frames[index];
    }
  }
  return null;
}

function nearestAfter(frames: ScreenshotEvent[], tsMs: number): ScreenshotEvent | null {
  for (const frame of frames) {
    if (frame.tsMs >= tsMs) {
      return frame;
    }
  }
  return null;
}

export function resolveScreenshotContext(
  selectedEvent: CaptureEvent | null,
  screenshots: ScreenshotEvent[]
): ScreenshotContext {
  if (screenshots.length === 0) {
    return { current: null, before: null, after: null };
  }

  if (!selectedEvent) {
    return {
      current: screenshots[0],
      before: null,
      after: screenshots[0]
    };
  }

  if (selectedEvent.kind === "screenshot") {
    const index = findIndexById(screenshots, selectedEvent.id);
    if (index < 0) {
      return { current: screenshots[0], before: null, after: screenshots[0] };
    }
    return {
      current: screenshots[index],
      before: index > 0 ? screenshots[index - 1] : null,
      after: screenshots[index]
    };
  }

  const closest =
    nearestAtOrBefore(screenshots, selectedEvent.tsMs) ??
    nearestAfter(screenshots, selectedEvent.tsMs) ??
    screenshots[0];

  const closestIndex = findIndexById(screenshots, closest.id);
  const before = closestIndex > 0 ? screenshots[closestIndex - 1] : null;
  return {
    current: closest,
    before,
    after: closest
  };
}
