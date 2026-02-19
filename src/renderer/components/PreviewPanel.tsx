import type { CaptureEvent } from "../../shared/types";
import { eventTypeLabel, formatClock, formatRelMs } from "../view-model/eventSummaries";
import type { FilmstripFrameViewModel } from "../view-model/types";

interface PreviewPanelProps {
  selectedEvent: CaptureEvent | null;
  currentFrame: FilmstripFrameViewModel | null;
  liveScreenshotSyncEnabled: boolean;
  onToggleLiveScreenshotSync: (enabled: boolean) => void;
  toggleDisabled?: boolean;
}

export function PreviewPanel({
  selectedEvent,
  currentFrame,
  liveScreenshotSyncEnabled,
  onToggleLiveScreenshotSync,
  toggleDisabled = false
}: PreviewPanelProps): JSX.Element {
  return (
    <section className="preview-panel">
      <header className="preview-header">
        <div className="preview-header-main">
          <h2>Preview</h2>
          <label className="preview-live-toggle">
            <input
              type="checkbox"
              checked={liveScreenshotSyncEnabled}
              disabled={toggleDisabled}
              onChange={(event) => onToggleLiveScreenshotSync(event.target.checked)}
            />
            <span>Live</span>
          </label>
        </div>
        {selectedEvent && (
          <div className="preview-meta">
            <span>{eventTypeLabel(selectedEvent.kind)}</span>
            <span>{formatRelMs(selectedEvent.tRelMs)}</span>
            <span>{formatClock(selectedEvent.tsMs)}</span>
            {selectedEvent.pageUrl && <span>{selectedEvent.pageUrl}</span>}
          </div>
        )}
      </header>

      <div className="preview-main-shot">
        {!selectedEvent ? (
          <div className="preview-empty">No event selected</div>
        ) : currentFrame?.payload ? (
          <img src={currentFrame.payload.dataUrl} alt={currentFrame.payload.path} />
        ) : (
          <div className="preview-empty">No screenshots captured</div>
        )}
      </div>
    </section>
  );
}
