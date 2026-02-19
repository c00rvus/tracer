import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";
import type { FilmstripFrameViewModel } from "../view-model/types";

interface TimelineRange {
  startMs: number;
  endMs: number;
}

interface FilmstripTimelineProps {
  frames: FilmstripFrameViewModel[];
  selectedEventId: string | null;
  totalDurationMs: number;
  maxFrameDurationMs?: number;
  hoveredWindow: { startMs: number; durationMs: number } | null;
  liveHoverSyncEnabled: boolean;
  combinedLiveAutoScrollEnabled: boolean;
  rangeSelectionEnabled: boolean;
  selectedRange: TimelineRange | null;
  onSelectEvent: (eventId: string) => void;
  onRangeChange: (range: TimelineRange | null) => void;
}

interface PositionedFrame {
  frame: FilmstripFrameViewModel;
  leftPx: number;
  widthPx: number;
}

function rulerLabel(ms: number): string {
  if (ms === 0) {
    return "0s";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

export function FilmstripTimeline({
  frames,
  selectedEventId,
  totalDurationMs,
  maxFrameDurationMs = 2000,
  hoveredWindow,
  liveHoverSyncEnabled,
  combinedLiveAutoScrollEnabled,
  rangeSelectionEnabled,
  selectedRange,
  onSelectEvent,
  onRangeChange
}: FilmstripTimelineProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const selectedFrameRef = useRef<HTMLButtonElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const suppressThumbClickUntilMsRef = useRef(0);
  const rangeDragActiveRef = useRef(false);
  const skipNextAutoScrollRef = useRef(false);
  const [dragSelection, setDragSelection] = useState<TimelineRange | null>(null);

  const layout = useMemo(() => {
    const minFrameWidth = 56;
    const pxPerMs = 0.18;
    const fallbackDurationMs = 500;

    const positioned: PositionedFrame[] = [];
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      const previous = index > 0 ? frames[index - 1] : null;
      const next = index < frames.length - 1 ? frames[index + 1] : null;

      const durationMs = next
        ? Math.max(0, next.event.tRelMs - frame.event.tRelMs)
        : previous
          ? Math.max(0, frame.event.tRelMs - previous.event.tRelMs)
          : fallbackDurationMs;

      // Keep paused/idle gaps visually empty instead of stretching the previous frame.
      const visualDurationMs = Math.min(durationMs, maxFrameDurationMs);
      const widthPx = Math.max(minFrameWidth, visualDurationMs * pxPerMs);
      const leftPx = frame.event.tRelMs * pxPerMs;
      positioned.push({ frame, leftPx, widthPx });
    }

    const contentEndPx = positioned.reduce((max, item) => {
      return Math.max(max, item.leftPx + item.widthPx);
    }, 0);

    const totalWidth = Math.max(
      840,
      totalDurationMs * pxPerMs + 80,
      positioned.length > 0 ? contentEndPx + 24 : 840
    );

    const tickStep = 500;
    const ticks: number[] = [];
    const tickMax = Math.max(500, Math.ceil(totalDurationMs / tickStep) * tickStep);
    for (let ms = 0; ms <= tickMax; ms += tickStep) {
      ticks.push(ms);
    }

    return {
      pxPerMs,
      totalWidth,
      ticks,
      positioned
    };
  }, [frames, maxFrameDurationMs, totalDurationMs]);

  const toRelMs = useCallback(
    (clientX: number): number | null => {
      if (!trackRef.current) {
        return null;
      }
      const rect = trackRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(layout.totalWidth, clientX - rect.left));
      return x / layout.pxPerMs;
    },
    [layout.pxPerMs, layout.totalWidth]
  );

  const handleRangeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!rangeSelectionEnabled || event.button !== 0) {
        return;
      }
      const anchorMs = toRelMs(event.clientX);
      if (anchorMs === null) {
        return;
      }

      event.preventDefault();
      rangeDragActiveRef.current = true;
      skipNextAutoScrollRef.current = true;
      setDragSelection({ startMs: anchorMs, endMs: anchorMs });

      const handleMouseMove = (moveEvent: MouseEvent): void => {
        moveEvent.preventDefault();
        const currentMs = toRelMs(moveEvent.clientX);
        if (currentMs === null) {
          return;
        }
        setDragSelection({
          startMs: Math.min(anchorMs, currentMs),
          endMs: Math.max(anchorMs, currentMs)
        });
      };

      const handleMouseUp = (upEvent: MouseEvent): void => {
        upEvent.preventDefault();
        rangeDragActiveRef.current = false;
        skipNextAutoScrollRef.current = true;
        suppressThumbClickUntilMsRef.current = Date.now() + 180;

        const currentMs = toRelMs(upEvent.clientX) ?? anchorMs;
        const finalRange = {
          startMs: Math.min(anchorMs, currentMs),
          endMs: Math.max(anchorMs, currentMs)
        };

        setDragSelection(null);
        onRangeChange(finalRange);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [onRangeChange, rangeSelectionEnabled, toRelMs]
  );

  const handleThumbClick = useCallback(
    (eventId: string, inSelectedRange: boolean) => {
      if (rangeSelectionEnabled) {
        return;
      }
      if (rangeDragActiveRef.current) {
        return;
      }
      if (Date.now() < suppressThumbClickUntilMsRef.current) {
        return;
      }
      if (selectedRange && !inSelectedRange) {
        onRangeChange(null);
      }
      onSelectEvent(eventId);
    },
    [onRangeChange, onSelectEvent, rangeSelectionEnabled, selectedRange]
  );

  const activeRange = dragSelection ?? selectedRange;
  const rangeOverlayStyle =
    activeRange && activeRange.endMs >= activeRange.startMs
      ? {
          left: `${Math.max(0, activeRange.startMs * layout.pxPerMs)}px`,
          width: `${Math.max(2, (activeRange.endMs - activeRange.startMs) * layout.pxPerMs)}px`
        }
      : null;
  const hoverIndicatorStyle = useMemo(() => {
    if (!hoveredWindow) {
      return null;
    }
    const leftPx = Math.max(0, Math.min(layout.totalWidth, hoveredWindow.startMs * layout.pxPerMs));
    const rawWidth = Math.max(14, hoveredWindow.durationMs * layout.pxPerMs);
    const maxWidth = Math.max(14, layout.totalWidth - leftPx);
    return {
      left: `${leftPx}px`,
      width: `${Math.min(rawWidth, maxWidth)}px`
    };
  }, [hoveredWindow, layout.pxPerMs, layout.totalWidth]);

  useEffect(() => {
    if (!selectedFrameRef.current || !scrollRef.current) {
      return;
    }
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    selectedFrameRef.current.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center"
    });
  }, [selectedEventId]);

  useEffect(() => {
    if (!liveHoverSyncEnabled || !hoveredWindow || !scrollRef.current) {
      return;
    }

    const container = scrollRef.current;
    const indicatorCenterPx = hoveredWindow.startMs * layout.pxPerMs;
    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const targetScrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, indicatorCenterPx - container.clientWidth / 2)
    );

    container.scrollTo({
      left: targetScrollLeft,
      behavior: "auto"
    });
  }, [hoveredWindow, layout.pxPerMs, liveHoverSyncEnabled]);

  useEffect(() => {
    if (!combinedLiveAutoScrollEnabled || !scrollRef.current || layout.positioned.length === 0) {
      return;
    }

    const container = scrollRef.current;
    const latest = layout.positioned[layout.positioned.length - 1];
    const latestCenterPx = latest.leftPx + latest.widthPx / 2;
    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const targetScrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, latestCenterPx - container.clientWidth / 2)
    );

    container.scrollTo({
      left: targetScrollLeft,
      behavior: "smooth"
    });
  }, [combinedLiveAutoScrollEnabled, layout.positioned]);

  return (
    <section className="filmstrip-panel">
      <div className="filmstrip-scroll" ref={scrollRef}>
        <div
          className={`filmstrip-track ${rangeSelectionEnabled ? "range-select-enabled" : ""}`}
          style={{ width: `${layout.totalWidth}px` }}
          ref={trackRef}
        >
          {rangeSelectionEnabled && (
            <div className="filmstrip-range-capture" onMouseDown={handleRangeMouseDown} />
          )}
          {rangeOverlayStyle && <div className="filmstrip-range-selection" style={rangeOverlayStyle} />}

          <div className="filmstrip-ruler">
            {layout.ticks.map((tickMs) => (
              <div
                key={tickMs}
                className="ruler-tick"
                style={{ left: `${tickMs * layout.pxPerMs}px` }}
              >
                <span>{rulerLabel(tickMs)}</span>
              </div>
            ))}
          </div>

          <div className="filmstrip-frames">
            {hoverIndicatorStyle && (
              <div className="filmstrip-hover-indicator" style={hoverIndicatorStyle} />
            )}

            {layout.positioned.length === 0 && (
              <div className="filmstrip-empty">No screenshots captured</div>
            )}

            {layout.positioned.map(({ frame, leftPx, widthPx }) => {
              const selected = selectedEventId === frame.event.id;
              const inSelectedRange =
                !selectedRange ||
                (frame.event.tRelMs >= selectedRange.startMs &&
                  frame.event.tRelMs <= selectedRange.endMs);
              return (
                <button
                  key={frame.event.id}
                  ref={selected ? selectedFrameRef : null}
                  className={`filmstrip-thumb ${selected ? "selected" : ""}`}
                  style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                  onClick={() => handleThumbClick(frame.event.id, inSelectedRange)}
                >
                  {frame.payload ? (
                    <img src={frame.payload.dataUrl} alt={frame.payload.path} />
                  ) : (
                    <div className="thumb-placeholder">loading</div>
                  )}
                  <span className="thumb-time">{(frame.event.tRelMs / 1000).toFixed(2)}s</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
