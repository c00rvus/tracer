import type { CaptureEvent, ScreenshotEvent, ScreenshotPayload } from "../../shared/types";

export interface EventRowViewModel {
  id: string;
  event: CaptureEvent;
  kind: CaptureEvent["kind"];
  badge: string;
  title: string;
  subtitle: string;
  deltaMs: number;
  durationMs: number;
  relMs: number;
  clockLabel: string;
}

export interface FilmstripFrameViewModel {
  event: ScreenshotEvent;
  payload: ScreenshotPayload | null;
}
