import appIcon from "../../../build/icon.png";

interface WindowTitleBarProps {
  isMaximized: boolean;
  sessionFileName: string | null;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export function WindowTitleBar({
  isMaximized,
  sessionFileName,
  onMinimize,
  onToggleMaximize,
  onClose
}: WindowTitleBarProps): JSX.Element {
  const title = sessionFileName ?? "No active recording";

  return (
    <header className="window-titlebar">
      <div className="window-titlebar-main window-drag-region" onDoubleClick={onToggleMaximize}>
        <div className="window-brand">
          <img src={appIcon} className="window-app-icon" alt="" aria-hidden />
          <span className="window-app-title">Tracer Desktop</span>
        </div>
        <div className="window-session-name" title={title}>
          {title}
        </div>
      </div>
      <div className="window-controls" role="group" aria-label="Window controls">
        <button type="button" className="window-control-btn" onClick={onMinimize} aria-label="Minimize window">
          <svg viewBox="0 0 10 10" aria-hidden>
            <path d="M1 6.5h8v1H1z" />
          </svg>
        </button>
        <button
          type="button"
          className="window-control-btn"
          onClick={onToggleMaximize}
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
        >
          {isMaximized ? (
            <svg viewBox="0 0 10 10" aria-hidden>
              <path d="M2 3h5v5H2zM3 2h5v5H7V3H3z" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" aria-hidden>
              <path d="M2 2h6v6H2zM3 3v4h4V3z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="window-control-btn window-control-close"
          onClick={onClose}
          aria-label="Close window"
        >
          <svg viewBox="0 0 10 10" aria-hidden>
            <path d="M2.2 1.5 5 4.3l2.8-2.8.7.7L5.7 5l2.8 2.8-.7.7L5 5.7 2.2 8.5l-.7-.7L4.3 5 1.5 2.2z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
