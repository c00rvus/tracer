import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type Orientation = "vertical" | "horizontal";

interface ResizableSplitProps {
  orientation: Orientation;
  primary: ReactNode;
  secondary: ReactNode;
  className?: string;
  initialRatio?: number;
  minPrimarySize?: number;
  minSecondarySize?: number;
  storageKey?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ResizableSplit({
  orientation,
  primary,
  secondary,
  className,
  initialRatio = 0.5,
  minPrimarySize = 160,
  minSecondarySize = 160,
  storageKey
}: ResizableSplitProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState<number>(() => clamp(initialRatio, 0.15, 0.85));
  const ratioRef = useRef<number>(ratio);

  const applyRatioToContainer = useCallback(
    (nextRatio: number): void => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const ratioPercent = `${(nextRatio * 100).toFixed(3)}%`;
      if (orientation === "vertical") {
        container.style.gridTemplateColumns = `${ratioPercent} 6px minmax(0, 1fr)`;
      } else {
        container.style.gridTemplateRows = `${ratioPercent} 6px minmax(0, 1fr)`;
      }
    },
    [orientation]
  );

  useEffect(() => {
    ratioRef.current = ratio;
  }, [ratio]);

  useLayoutEffect(() => {
    applyRatioToContainer(ratio);
  }, [applyRatioToContainer, ratio]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return;
      }
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        const nextRatio = clamp(parsed, 0.1, 0.9);
        ratioRef.current = nextRatio;
        setRatio(nextRatio);
      }
    } catch {
      // ignore localStorage read errors
    }
  }, [storageKey]);

  const persistRatio = useCallback(
    (value: number): void => {
      if (!storageKey) {
        return;
      }
      try {
        localStorage.setItem(storageKey, String(value));
      } catch {
        // ignore localStorage write errors
      }
    },
    [storageKey]
  );

  const onMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const totalSize = orientation === "vertical" ? rect.width : rect.height;
      if (totalSize <= 0) {
        return;
      }

      const minRatio = clamp(minPrimarySize / totalSize, 0, 0.95);
      const maxRatio = clamp(1 - minSecondarySize / totalSize, 0.05, 1);
      let pendingRatio = ratioRef.current;
      let rafId: number | null = null;

      const flushPendingRatio = (commitToState: boolean): void => {
        rafId = null;
        if (pendingRatio !== ratioRef.current) {
          ratioRef.current = pendingRatio;
          applyRatioToContainer(pendingRatio);
        }
        if (commitToState) {
          setRatio(pendingRatio);
        }
      };

      const scheduleRatioUpdate = (): void => {
        if (rafId !== null) {
          return;
        }
        rafId = window.requestAnimationFrame(() => {
          flushPendingRatio(false);
        });
      };

      const onMouseMove = (moveEvent: MouseEvent): void => {
        const pointer =
          orientation === "vertical"
            ? moveEvent.clientX - rect.left
            : moveEvent.clientY - rect.top;
        const nextRatio = clamp(pointer / totalSize, minRatio, maxRatio);
        if (nextRatio === pendingRatio) {
          return;
        }
        pendingRatio = nextRatio;
        scheduleRatioUpdate();
      };

      const onMouseUp = (): void => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.classList.remove("resizing-active");
        document.body.classList.remove("resizing-vertical");
        document.body.classList.remove("resizing-horizontal");

        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        flushPendingRatio(true);
        persistRatio(pendingRatio);
      };

      document.body.classList.add("resizing-active");
      document.body.classList.add(
        orientation === "vertical" ? "resizing-vertical" : "resizing-horizontal"
      );
      window.addEventListener("mousemove", onMouseMove, { passive: true });
      window.addEventListener("mouseup", onMouseUp);
    },
    [applyRatioToContainer, minPrimarySize, minSecondarySize, orientation, persistRatio]
  );

  return (
    <div
      ref={containerRef}
      className={`resizable-split ${orientation} ${className ?? ""}`.trim()}
    >
      <div className="resizable-pane primary">{primary}</div>
      <div className="resizable-handle" onMouseDown={onMouseDown} />
      <div className="resizable-pane secondary">{secondary}</div>
    </div>
  );
}
