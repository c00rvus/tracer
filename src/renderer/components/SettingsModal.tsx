import { useEffect, useState } from "react";
import {
  DEFAULT_APP_SETTINGS,
  MAX_SCREENSHOT_INTERVAL_MS,
  MIN_SCREENSHOT_INTERVAL_MS,
  normalizeAppSettings,
  normalizeStartUrlInput
} from "../../shared/settings";
import type { AppSettings } from "../../shared/types";

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings | null;
  busy: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSave: (settings: AppSettings) => void;
  onPickDefaultSaveDir: () => Promise<string | null>;
}

type HelpKey = "autosave" | "fullPage" | "pageLoad" | "consoleError" | "networkFail";

export function SettingsModal({
  open,
  settings,
  busy,
  errorMessage,
  onClose,
  onSave,
  onPickDefaultSaveDir
}: SettingsModalProps): JSX.Element {
  const [draft, setDraft] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [newStartUrl, setNewStartUrl] = useState("");
  const [openHelp, setOpenHelp] = useState<HelpKey | null>(null);
  const [pickDirBusy, setPickDirBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(normalizeAppSettings(settings ?? DEFAULT_APP_SETTINGS));
    setNewStartUrl("");
    setOpenHelp(null);
  }, [open, settings]);

  if (!open) {
    return <></>;
  }

  const commit = (): void => {
    onSave(normalizeAppSettings(draft));
  };

  const pickDirectory = async (): Promise<void> => {
    if (pickDirBusy || busy) {
      return;
    }
    setPickDirBusy(true);
    try {
      const directory = await onPickDefaultSaveDir();
      if (directory) {
        setDraft((previous) => ({
          ...previous,
          defaultSessionSaveDir: directory
        }));
      }
    } finally {
      setPickDirBusy(false);
    }
  };

  const addStartUrl = (): void => {
    const normalized = normalizeStartUrlInput(newStartUrl);
    if (!normalized) {
      return;
    }

    setDraft((previous) => {
      if (previous.startUrls.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
        return previous;
      }

      const nextStartUrls = [...previous.startUrls, normalized];
      return {
        ...previous,
        startUrls: nextStartUrls,
        defaultStartUrl: previous.defaultStartUrl || normalized
      };
    });
    setNewStartUrl("");
  };

  const removeStartUrl = (urlToRemove: string): void => {
    setDraft((previous) => {
      const nextStartUrls = previous.startUrls.filter((item) => item !== urlToRemove);
      const nextDefault =
        previous.defaultStartUrl === urlToRemove
          ? nextStartUrls[0] ?? ""
          : previous.defaultStartUrl;
      return {
        ...previous,
        startUrls: nextStartUrls,
        defaultStartUrl: nextDefault
      };
    });
  };

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-modal-header">
          <h2 id="settings-title">Settings</h2>
          <p>Saved settings are applied immediately.</p>
        </header>

        <div className="settings-modal-body">
          <div className="settings-field">
            <span>Start URLs</span>
            <div className="settings-url-add-row">
              <input
                type="text"
                placeholder="https://example.com"
                value={newStartUrl}
                onChange={(event) => setNewStartUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addStartUrl();
                  }
                }}
              />
              <button type="button" disabled={busy} onClick={addStartUrl}>
                Add
              </button>
            </div>
            <p className="settings-path-note">
              Add one or more URLs and choose which one opens by default.
            </p>
            <div className="settings-url-list">
              {draft.startUrls.length === 0 ? (
                <p className="settings-url-empty">No start URLs configured.</p>
              ) : (
                draft.startUrls.map((url) => (
                  <div key={url} className="settings-url-item">
                    <label className="settings-url-default">
                      <input
                        type="radio"
                        name="default-start-url"
                        checked={draft.defaultStartUrl === url}
                        disabled={busy}
                        onChange={() =>
                          setDraft((previous) => ({
                            ...previous,
                            defaultStartUrl: url
                          }))
                        }
                      />
                      <span>{url}</span>
                    </label>
                    <button type="button" disabled={busy} onClick={() => removeStartUrl(url)}>
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <label className="settings-field">
            <span>Capture Interval (ms)</span>
            <input
              type="number"
              min={MIN_SCREENSHOT_INTERVAL_MS}
              max={MAX_SCREENSHOT_INTERVAL_MS}
              step={50}
              value={draft.screenshotIntervalMs}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  screenshotIntervalMs: Number(event.target.value)
                }))
              }
            />
          </label>

          <div className="settings-field">
            <span>Default Session Save Directory</span>
            <div className="settings-path-row">
              <button type="button" disabled={busy || pickDirBusy} onClick={() => void pickDirectory()}>
                Choose Folder
              </button>
            </div>
            <p className="settings-path-value">{draft.defaultSessionSaveDir}</p>
            <p className="settings-path-note">
              Used when auto-save is enabled.
            </p>
          </div>

          <div className="settings-check">
            <input
              id="setting-autosave"
              type="checkbox"
              checked={draft.autoSaveOnStopOrClose}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  autoSaveOnStopOrClose: event.target.checked
                }))
              }
            />
            <label className="settings-check-label" htmlFor="setting-autosave">
              Auto-save session on Stop/browser close
            </label>
            <button
              type="button"
              className="settings-help"
              aria-label="Explain auto-save behavior"
              aria-expanded={openHelp === "autosave"}
              onClick={() =>
                setOpenHelp((previous) => (previous === "autosave" ? null : "autosave"))
              }
            >
              ?
            </button>
            {openHelp === "autosave" && (
              <p className="settings-help-text">
                When enabled, Stop and browser close automatically create a session archive.
              </p>
            )}
          </div>

          <div className="settings-check">
            <input
              id="setting-full-page"
              type="checkbox"
              checked={draft.fullPageScreenshots}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  fullPageScreenshots: event.target.checked
                }))
              }
            />
            <label className="settings-check-label" htmlFor="setting-full-page">
              Capture full-page screenshots
            </label>
            <button
              type="button"
              className="settings-help"
              aria-label="Explain full-page screenshots"
              aria-expanded={openHelp === "fullPage"}
              onClick={() =>
                setOpenHelp((previous) => (previous === "fullPage" ? null : "fullPage"))
              }
            >
              ?
            </button>
            {openHelp === "fullPage" && (
              <p className="settings-help-text">
                Captures the full scrollable page instead of only the visible viewport.
              </p>
            )}
          </div>

          <div className="settings-check">
            <input
              id="setting-page-load"
              type="checkbox"
              checked={draft.screenshotOnPageLoad}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  screenshotOnPageLoad: event.target.checked
                }))
              }
            />
            <label className="settings-check-label" htmlFor="setting-page-load">
              Capture screenshot when page load completes
            </label>
            <button
              type="button"
              className="settings-help"
              aria-label="Explain page load screenshot trigger"
              aria-expanded={openHelp === "pageLoad"}
              onClick={() =>
                setOpenHelp((previous) => (previous === "pageLoad" ? null : "pageLoad"))
              }
            >
              ?
            </button>
            {openHelp === "pageLoad" && (
              <p className="settings-help-text">
                Creates a screenshot when the page fires the `load` event.
              </p>
            )}
          </div>

          <div className="settings-check">
            <input
              id="setting-console-error"
              type="checkbox"
              checked={draft.screenshotOnConsoleError}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  screenshotOnConsoleError: event.target.checked
                }))
              }
            />
            <label className="settings-check-label" htmlFor="setting-console-error">
              Capture screenshot on `console.error`
            </label>
            <button
              type="button"
              className="settings-help"
              aria-label="Explain console error screenshot trigger"
              aria-expanded={openHelp === "consoleError"}
              onClick={() =>
                setOpenHelp((previous) => (previous === "consoleError" ? null : "consoleError"))
              }
            >
              ?
            </button>
            {openHelp === "consoleError" && (
              <p className="settings-help-text">
                Creates a screenshot whenever a `console.error` message is emitted.
              </p>
            )}
          </div>

          <div className="settings-check">
            <input
              id="setting-network-fail"
              type="checkbox"
              checked={draft.screenshotOnNetworkFail}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  screenshotOnNetworkFail: event.target.checked
                }))
              }
            />
            <label className="settings-check-label" htmlFor="setting-network-fail">
              Capture screenshot on network failures
            </label>
            <button
              type="button"
              className="settings-help"
              aria-label="Explain network failure screenshot trigger"
              aria-expanded={openHelp === "networkFail"}
              onClick={() =>
                setOpenHelp((previous) => (previous === "networkFail" ? null : "networkFail"))
              }
            >
              ?
            </button>
            {openHelp === "networkFail" && (
              <p className="settings-help-text">
                Creates a screenshot whenever a request fails (`Network.loadingFailed`).
              </p>
            )}
          </div>

          {errorMessage && <p className="settings-error">{errorMessage}</p>}
        </div>

        <footer className="settings-modal-footer">
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} onClick={commit}>
            Save
          </button>
        </footer>
      </section>
    </div>
  );
}
