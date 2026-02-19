import type { SessionStatus } from "../../shared/types";

interface TraceToolbarProps {
  status: SessionStatus;
  busy: boolean;
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
  onOpen: () => void;
  onSettings: () => void;
  onToggleRangeSelection: () => void;
  onClearRangeSelection: () => void;
}

export function TraceToolbar({
  status,
  busy,
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
  onOpen,
  onSettings,
  onToggleRangeSelection,
  onClearRangeSelection
}: TraceToolbarProps): JSX.Element {
  return (
    <header className="trace-toolbar">
      <div className="toolbar-actions-left">
        <button
          disabled={busy || status.state === "capturing" || status.state === "paused"}
          onClick={onLaunch}
        >
          Launch Browser
        </button>
        <button
          disabled={busy || status.state === "capturing" || status.state === "paused"}
          onClick={onLaunchAndCapture}
        >
          Launch+Cap
        </button>
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
        <button
          disabled={
            busy ||
            (status.state !== "captured" &&
              status.state !== "capturing" &&
              status.state !== "paused")
          }
          onClick={onSave}
        >
          Save Session
        </button>
        <button disabled={busy} onClick={onOpen}>
          Import
        </button>
        <button disabled={busy} onClick={onSettings}>
          Settings
        </button>
      </div>
    </header>
  );
}
