import { useEffect, useRef, useState } from "react";
import type { SessionStatus } from "../../shared/types";

interface TraceToolbarProps {
  status: SessionStatus;
  busy: boolean;
  importInFlight: boolean;
  videoExportInFlight: boolean;
  pauseResumeSupported: boolean;
  rangeSelectionEnabled: boolean;
  hasTimeRangeSelection: boolean;
  onLaunch: () => void;
  onLaunchAndCapture: () => void;
  onCapture: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSave: () => void;
  onSaveRange: () => void;
  onExportVideo: () => void;
  onExportRangeVideo: () => void;
  onOpen: () => void;
  onSettings: () => void;
  onToggleRangeSelection: () => void;
  onClearRangeSelection: () => void;
}

export function TraceToolbar({
  status,
  busy,
  importInFlight,
  videoExportInFlight,
  pauseResumeSupported,
  rangeSelectionEnabled,
  hasTimeRangeSelection,
  onLaunch,
  onLaunchAndCapture,
  onCapture,
  onPause,
  onResume,
  onStop,
  onSave,
  onSaveRange,
  onExportVideo,
  onExportRangeVideo,
  onOpen,
  onSettings,
  onToggleRangeSelection,
  onClearRangeSelection
}: TraceToolbarProps): JSX.Element {
  const launchMenuRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const [openMenu, setOpenMenu] = useState<"launch" | "export" | null>(null);

  const launchActionsDisabled = busy || status.state === "capturing" || status.state === "paused";
  const saveSessionDisabled =
    busy ||
    (status.state !== "captured" && status.state !== "capturing" && status.state !== "paused");
  const saveRangeDisabled =
    busy ||
    !hasTimeRangeSelection ||
    (status.state !== "captured" &&
      status.state !== "capturing" &&
      status.state !== "paused" &&
      status.state !== "reviewing");
  const exportVideoDisabled =
    busy || videoExportInFlight || (status.state !== "captured" && status.state !== "reviewing");
  const exportRangeVideoDisabled =
    busy ||
    videoExportInFlight ||
    !hasTimeRangeSelection ||
    (status.state !== "captured" && status.state !== "reviewing");
  const exportMenuDisabled =
    saveSessionDisabled && saveRangeDisabled && exportVideoDisabled && exportRangeVideoDisabled;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setOpenMenu(null);
        return;
      }
      if (launchMenuRef.current?.contains(target) || exportMenuRef.current?.contains(target)) {
        return;
      }
      setOpenMenu(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (busy) {
      setOpenMenu(null);
    }
  }, [busy]);

  const toggleMenu = (menu: "launch" | "export") => {
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  const closeMenuAndRun = (action: () => void) => {
    setOpenMenu(null);
    action();
  };

  return (
    <header className="trace-toolbar">
      <div className="toolbar-actions-left">
        <div ref={launchMenuRef} className="toolbar-menu">
          <button
            type="button"
            className="toolbar-menu-button"
            disabled={launchActionsDisabled}
            aria-expanded={openMenu === "launch"}
            aria-haspopup="menu"
            onClick={() => toggleMenu("launch")}
          >
            Open
            <span className="toolbar-menu-caret" aria-hidden>
              ▾
            </span>
          </button>
          {openMenu === "launch" && (
            <div className="toolbar-menu-popover" role="menu" aria-label="Open actions">
              <button type="button" disabled={launchActionsDisabled} onClick={() => closeMenuAndRun(onLaunch)}>
                Launch Browser
              </button>
              <button
                type="button"
                disabled={launchActionsDisabled}
                onClick={() => closeMenuAndRun(onLaunchAndCapture)}
              >
                Launch+Cap
              </button>
            </div>
          )}
        </div>
        <button
          disabled={busy}
          className={rangeSelectionEnabled ? "toggle-active" : ""}
          onClick={onToggleRangeSelection}
        >
          Select Range
        </button>
        <button disabled={busy || !hasTimeRangeSelection} onClick={onClearRangeSelection}>
          Clear Range
        </button>
      </div>
      <div className="toolbar-actions-right">
        <button disabled={busy || status.state !== "browser_ready"} onClick={onCapture}>
          Capture
        </button>
        {status.state === "paused" ? (
          <button disabled={busy || !pauseResumeSupported} onClick={onResume}>
            Resume
          </button>
        ) : (
          <button
            disabled={busy || status.state !== "capturing" || !pauseResumeSupported}
            onClick={onPause}
          >
            Pause
          </button>
        )}
        <button
          disabled={busy || (status.state !== "capturing" && status.state !== "paused")}
          onClick={onStop}
        >
          Stop
        </button>
        <div ref={exportMenuRef} className="toolbar-menu">
          <button
            type="button"
            className="toolbar-menu-button"
            disabled={exportMenuDisabled}
            aria-expanded={openMenu === "export"}
            aria-haspopup="menu"
            onClick={() => toggleMenu("export")}
          >
            {videoExportInFlight ? "Exporting..." : "Export"}
            <span className="toolbar-menu-caret" aria-hidden>
              ▾
            </span>
          </button>
          {openMenu === "export" && (
            <div
              className="toolbar-menu-popover toolbar-menu-popover-right"
              role="menu"
              aria-label="Export actions"
            >
              <button type="button" disabled={saveSessionDisabled} onClick={() => closeMenuAndRun(onSave)}>
                Save Session
              </button>
              <button type="button" disabled={saveRangeDisabled} onClick={() => closeMenuAndRun(onSaveRange)}>
                Save Range
              </button>
              <button
                type="button"
                disabled={exportVideoDisabled}
                onClick={() => closeMenuAndRun(onExportVideo)}
              >
                {videoExportInFlight ? "Exporting..." : "Export Video"}
              </button>
              <button
                type="button"
                disabled={exportRangeVideoDisabled}
                onClick={() => closeMenuAndRun(onExportRangeVideo)}
              >
                Export Range Video
              </button>
            </div>
          )}
        </div>
        <button disabled={busy || importInFlight} onClick={onOpen}>
          {importInFlight ? "Importing..." : "Import"}
        </button>
        <button disabled={busy} onClick={onSettings}>
          Settings
        </button>
      </div>
    </header>
  );
}
