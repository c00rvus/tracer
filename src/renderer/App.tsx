import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  CaptureEvent,
  ScreenshotEvent,
  ScreenshotPayload,
  SessionStatus
} from "../shared/types";
import { ActionsPanel } from "./components/ActionsPanel";
import { FilmstripTimeline } from "./components/FilmstripTimeline";
import { InspectorTabs } from "./components/InspectorTabs";
import { PreviewPanel } from "./components/PreviewPanel";
import { ResizableSplit } from "./components/ResizableSplit";
import { SettingsModal } from "./components/SettingsModal";
import { TraceToolbar } from "./components/TraceToolbar";
import { WindowTitleBar } from "./components/WindowTitleBar";
import { resolveScreenshotContext } from "./view-model/selectionResolvers";
import {
  buildRequestMap,
  ACTION_FILTER_OPTIONS,
  filterEventRows,
  getConsoleAroundEvent,
  getErrorsAroundEvent,
  getNetworkAroundEvent,
  getRequestIdFromEvent,
  getWindowByIndex,
  sortTimeline,
  toEventRows,
  type ActionFilterKind
} from "./view-model/timelineMapping";
import type { FilmstripFrameViewModel } from "./view-model/types";

const EMPTY_STATUS: SessionStatus = {
  state: "idle",
  sessionId: null,
  sessionFileName: null,
  createdAt: null,
  captureStartedAt: null,
  captureEndedAt: null,
  browserVersion: null,
  source: null,
  counts: {
    events: 0,
    screenshots: 0,
    networkRequests: 0
  },
  lastError: null
};

function isScreenshotEvent(event: CaptureEvent): event is ScreenshotEvent {
  return event.kind === "screenshot";
}

function isUserCanceledMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("canceled by user") ||
    normalized.includes("cancelled by user") ||
    normalized.includes("operation was canceled")
  );
}

const BANNER_AUTO_HIDE_MS = 5000;

const STORAGE_KEYS = {
  actionsLiveSync: "tracer.actions-live-sync",
  previewLiveSync: "tracer.preview-live-sync"
} as const;

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    return raw === "1";
  } catch {
    return fallback;
  }
}

function writeStoredBoolean(key: string, value: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore localStorage write errors
  }
}

export function App(): JSX.Element {
  const platform = window.tracer.window.platform;
  const isWindows = platform === "win32";
  const [status, setStatus] = useState<SessionStatus>(EMPTY_STATUS);
  const [timeline, setTimeline] = useState<CaptureEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<ActionFilterKind[]>(ACTION_FILTER_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [screenshotById, setScreenshotById] = useState<Record<string, ScreenshotPayload>>({});
  const [hoveredActionWindow, setHoveredActionWindow] = useState<{
    startMs: number;
    durationMs: number;
  } | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [pinnedFilmstripEventId, setPinnedFilmstripEventId] = useState<string | null>(null);
  const [rangeSelectionEnabled, setRangeSelectionEnabled] = useState(false);
  const [actionsLiveHoverSyncEnabled, setActionsLiveHoverSyncEnabled] = useState(() =>
    readStoredBoolean(STORAGE_KEYS.actionsLiveSync, false)
  );
  const [selectedTimeRange, setSelectedTimeRange] = useState<{ startMs: number; endMs: number } | null>(
    null
  );
  const [liveScreenshotSyncEnabled, setLiveScreenshotSyncEnabled] = useState(() =>
    readStoredBoolean(STORAGE_KEYS.previewLiveSync, false)
  );
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const pauseResumeSupported =
    typeof window.tracer.session.pauseCapture === "function" &&
    typeof window.tracer.session.resumeCapture === "function";

  const loadingScreenshotIdsRef = useRef<Set<string>>(new Set());
  const dismissedStatusErrorRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const currentStatus = await window.tracer.session.getStatus();
    setStatus(currentStatus);
    if (currentStatus.lastError) {
      if (isUserCanceledMessage(currentStatus.lastError)) {
        setErrorMessage(null);
      } else if (currentStatus.lastError !== dismissedStatusErrorRef.current) {
        setErrorMessage(currentStatus.lastError);
      }
    } else if (dismissedStatusErrorRef.current) {
      dismissedStatusErrorRef.current = null;
    }
    if (!currentStatus.sessionId) {
      setTimeline([]);
      return;
    }
    const events = await window.tracer.session.getTimeline(currentStatus.sessionId);
    setTimeline(events);
  }, []);

  const loadSettings = useCallback(async () => {
    const currentSettings = await window.tracer.session.getSettings();
    setSettings(currentSettings);
    return currentSettings;
  }, []);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    const tick = async () => {
      if (disposed || inFlight) {
        return;
      }
      inFlight = true;
      try {
        await refresh();
      } catch (error) {
        if (!disposed) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to refresh session.");
        }
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 1000);

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    void loadSettings().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load settings.");
    });
  }, [loadSettings]);

  useEffect(() => {
    if (!isWindows) {
      setIsWindowMaximized(false);
      return;
    }

    let disposed = false;
    const unsubscribe = window.tracer.window.onStateChanged((state) => {
      if (!disposed) {
        setIsWindowMaximized(state.isMaximized);
      }
    });

    void window.tracer.window
      .isMaximized()
      .then((state) => {
        if (!disposed) {
          setIsWindowMaximized(state.isMaximized);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to get window state.");
        }
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [isWindows]);

  useEffect(() => {
    writeStoredBoolean(STORAGE_KEYS.actionsLiveSync, actionsLiveHoverSyncEnabled);
  }, [actionsLiveHoverSyncEnabled]);

  useEffect(() => {
    writeStoredBoolean(STORAGE_KEYS.previewLiveSync, liveScreenshotSyncEnabled);
  }, [liveScreenshotSyncEnabled]);

  useEffect(() => {
    setScreenshotById({});
    loadingScreenshotIdsRef.current.clear();
  }, [status.sessionId]);

  const sortedTimeline = useMemo(() => sortTimeline(timeline), [timeline]);
  const logsTimeline = useMemo(() => {
    if (!selectedTimeRange) {
      return sortedTimeline;
    }
    return sortedTimeline.filter(
      (event) => event.tRelMs >= selectedTimeRange.startMs && event.tRelMs <= selectedTimeRange.endMs
    );
  }, [selectedTimeRange, sortedTimeline]);

  useEffect(() => {
    if (logsTimeline.length === 0) {
      setSelectedEventId(null);
      setPinnedFilmstripEventId(null);
      return;
    }
    if (!selectedEventId || !logsTimeline.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(logsTimeline[0].id);
      setPinnedFilmstripEventId(null);
    }
  }, [selectedEventId, logsTimeline]);

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) {
      return null;
    }
    return logsTimeline.find((event) => event.id === selectedEventId) ?? null;
  }, [selectedEventId, logsTimeline]);

  const selectedIndex = useMemo(() => {
    if (!selectedEventId) {
      return -1;
    }
    return logsTimeline.findIndex((event) => event.id === selectedEventId);
  }, [selectedEventId, logsTimeline]);

  const screenshotEvents = useMemo(
    () => sortedTimeline.filter((event): event is ScreenshotEvent => isScreenshotEvent(event)),
    [sortedTimeline]
  );

  useEffect(() => {
    if (screenshotEvents.length === 0) {
      return;
    }

    const missing = screenshotEvents.filter((event) => {
      if (screenshotById[event.screenshotId]) {
        return false;
      }
      return !loadingScreenshotIdsRef.current.has(event.screenshotId);
    });
    if (missing.length === 0) {
      return;
    }

    for (const event of missing) {
      loadingScreenshotIdsRef.current.add(event.screenshotId);
    }

    let canceled = false;

    void Promise.all(
      missing.map(async (event) => {
        const payload = await window.tracer.session.getScreenshot(event.screenshotId);
        return {
          screenshotId: event.screenshotId,
          payload
        };
      })
    )
      .then((results) => {
        if (canceled) {
          return;
        }
        setScreenshotById((previous) => {
          const next = { ...previous };
          for (const result of results) {
            if (result.payload) {
              next[result.screenshotId] = result.payload;
            }
          }
          return next;
        });
      })
      .catch((error) => {
        if (!canceled) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load screenshot.");
        }
      })
      .finally(() => {
        for (const event of missing) {
          loadingScreenshotIdsRef.current.delete(event.screenshotId);
        }
      });

    return () => {
      canceled = true;
    };
  }, [screenshotById, screenshotEvents]);

  const filmstripFrames = useMemo<FilmstripFrameViewModel[]>(() => {
    return screenshotEvents.map((event) => ({
      event,
      payload: screenshotById[event.screenshotId] ?? null
    }));
  }, [screenshotById, screenshotEvents]);

  const frameByEventId = useMemo(() => {
    const map = new Map<string, FilmstripFrameViewModel>();
    for (const frame of filmstripFrames) {
      map.set(frame.event.id, frame);
    }
    return map;
  }, [filmstripFrames]);

  const screenshotContext = useMemo(
    () => resolveScreenshotContext(selectedEvent, screenshotEvents),
    [selectedEvent, screenshotEvents]
  );
  const pinnedContextEventId =
    pinnedFilmstripEventId && screenshotEvents.some((event) => event.id === pinnedFilmstripEventId)
      ? pinnedFilmstripEventId
      : null;
  const contextScreenshotEventId = screenshotContext.current?.id ?? null;
  const latestScreenshotEvent = screenshotEvents[screenshotEvents.length - 1] ?? null;
  const liveSyncedEventId =
    liveScreenshotSyncEnabled && (status.state === "capturing" || status.state === "paused")
      ? latestScreenshotEvent?.id ?? null
      : null;
  const selectedFilmstripEventId = liveSyncedEventId ?? pinnedContextEventId ?? contextScreenshotEventId;

  const currentFrame = selectedFilmstripEventId
    ? frameByEventId.get(selectedFilmstripEventId) ?? null
    : null;

  const eventRows = useMemo(() => toEventRows(logsTimeline), [logsTimeline]);
  const filteredRows = useMemo(
    () => filterEventRows(eventRows, search, selectedKinds),
    [eventRows, search, selectedKinds]
  );

  const totalDurationMs = sortedTimeline.length > 0 ? sortedTimeline[sortedTimeline.length - 1].tRelMs : 0;

  const logWindow = useMemo(
    () => getWindowByIndex(logsTimeline, selectedIndex, 20),
    [selectedIndex, logsTimeline]
  );
  const centerTsMs = selectedEvent?.tsMs ?? Number.NaN;
  const errorWindow = useMemo(
    () => getErrorsAroundEvent(logsTimeline, centerTsMs),
    [centerTsMs, logsTimeline]
  );
  const consoleWindow = useMemo(
    () => getConsoleAroundEvent(logsTimeline, centerTsMs),
    [centerTsMs, logsTimeline]
  );
  const networkWindow = useMemo(
    () => getNetworkAroundEvent(logsTimeline, centerTsMs),
    [centerTsMs, logsTimeline]
  );

  const consoleEventsGlobal = useMemo(
    () => logsTimeline.filter((event) => event.kind === "console"),
    [logsTimeline]
  );
  const errorEventsGlobal = useMemo(
    () =>
      logsTimeline.filter((event) => {
        if (event.kind === "network_fail") {
          return true;
        }
        return event.kind === "console" && event.level === "error";
      }),
    [logsTimeline]
  );
  const networkEventsGlobal = useMemo(
    () =>
      logsTimeline.filter((event) => {
        return (
          event.kind === "network_request" ||
          event.kind === "network_response" ||
          event.kind === "network_fail"
        );
      }),
    [logsTimeline]
  );

  const requestMap = useMemo(() => buildRequestMap(logsTimeline), [logsTimeline]);
  const requestId = useMemo(() => getRequestIdFromEvent(selectedEvent), [selectedEvent]);
  const requestChain = useMemo(() => {
    if (!requestId) {
      return [];
    }
    return requestMap.get(requestId) ?? [];
  }, [requestId, requestMap]);

  const logTabEvents = logWindow.length > 0 ? logWindow : logsTimeline;
  const errorTabEvents = errorWindow.length > 0 ? errorWindow : errorEventsGlobal;
  const consoleTabEvents = consoleWindow.length > 0 ? consoleWindow : consoleEventsGlobal;
  const networkTabEvents =
    requestChain.length > 0
      ? requestChain
      : networkWindow.length > 0
        ? networkWindow
        : networkEventsGlobal;

  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setErrorMessage(null);
      dismissedStatusErrorRef.current = null;
      try {
        await action();
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error.";
        if (!isUserCanceledMessage(message)) {
          setErrorMessage(message);
        } else {
          await refresh();
        }
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const openSettings = useCallback(async () => {
    try {
      if (!settings) {
        await loadSettings();
      }
      setSettingsError(null);
      setSettingsOpen(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to open settings.");
    }
  }, [loadSettings, settings]);

  const saveSettings = useCallback(async (nextSettings: AppSettings) => {
    setSettingsBusy(true);
    setSettingsError(null);
    try {
      const saved = await window.tracer.session.updateSettings(nextSettings);
      setSettings(saved);
      setSettingsOpen(false);
      setSettingsNotice("Settings saved.");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Failed to save settings.");
    } finally {
      setSettingsBusy(false);
    }
  }, []);

  const pickDefaultSaveDir = useCallback(async () => {
    return window.tracer.session.chooseDefaultSaveDirectory();
  }, []);

  const findLogEventForScreenshot = useCallback(
    (screenshotEventId: string): string => {
      const screenshotEvent = logsTimeline.find(
        (event): event is ScreenshotEvent => event.id === screenshotEventId && event.kind === "screenshot"
      );
      if (!screenshotEvent) {
        const screenshotFromAll = sortedTimeline.find(
          (event): event is ScreenshotEvent => event.id === screenshotEventId && event.kind === "screenshot"
        );
        if (!screenshotFromAll) {
          return screenshotEventId;
        }

        const nearestVisible = logsTimeline.find(
          (event) => event.kind !== "screenshot" && event.tsMs >= screenshotFromAll.tsMs
        );
        if (nearestVisible) {
          return nearestVisible.id;
        }

        return logsTimeline[0]?.id ?? screenshotEventId;
      }

      let afterMatch: CaptureEvent | null = null;
      for (const event of logsTimeline) {
        if (event.kind === "screenshot") {
          continue;
        }
        if (event.tsMs >= screenshotEvent.tsMs) {
          afterMatch = event;
          break;
        }
      }

      if (afterMatch) {
        return afterMatch.id;
      }

      for (let index = logsTimeline.length - 1; index >= 0; index -= 1) {
        const event = logsTimeline[index];
        if (event.kind !== "screenshot" && event.tsMs < screenshotEvent.tsMs) {
          return event.id;
        }
      }

      return screenshotEventId;
    },
    [logsTimeline, sortedTimeline]
  );

  const handleSelectEvent = useCallback((eventId: string) => {
    setPinnedFilmstripEventId(null);
    setSelectedEventId(eventId);
  }, []);

  const handleSelectFilmstripEvent = useCallback(
    (screenshotEventId: string) => {
      setPinnedFilmstripEventId(screenshotEventId);
      setSelectedEventId(findLogEventForScreenshot(screenshotEventId));
    },
    [findLogEventForScreenshot]
  );

  const handleToggleRangeSelection = useCallback(() => {
    setRangeSelectionEnabled((enabled) => !enabled);
  }, []);

  const handleClearRangeSelection = useCallback(() => {
    setRangeSelectionEnabled(false);
    setSelectedTimeRange(null);
  }, []);

  const handleToggleKindFilter = useCallback((kind: ActionFilterKind, selected: boolean) => {
    setSelectedKinds((previous) => {
      if (selected) {
        if (previous.includes(kind)) {
          return previous;
        }
        return ACTION_FILTER_OPTIONS.filter((option) => previous.includes(option) || option === kind);
      }

      if (!previous.includes(kind)) {
        return previous;
      }
      return previous.filter((option) => option !== kind);
    });
  }, []);

  const handleSetKindFilters = useCallback((nextKinds: ActionFilterKind[]) => {
    setSelectedKinds(() => ACTION_FILTER_OPTIONS.filter((kind) => nextKinds.includes(kind)));
  }, []);

  const handleToggleLiveScreenshotSync = useCallback(
    (enabled: boolean) => {
      if (enabled === liveScreenshotSyncEnabled) {
        return;
      }

      if (!enabled) {
        setPinnedFilmstripEventId(selectedFilmstripEventId);
      }
      setLiveScreenshotSyncEnabled(enabled);
    },
    [liveScreenshotSyncEnabled, selectedFilmstripEventId]
  );

  const handleRangeChange = useCallback((range: { startMs: number; endMs: number } | null) => {
    if (!range) {
      setSelectedTimeRange(null);
      setRangeSelectionEnabled(false);
      return;
    }

    const startMs = Math.max(0, Math.min(range.startMs, range.endMs));
    const endMs = Math.max(startMs, Math.max(range.startMs, range.endMs));
    setSelectedTimeRange({ startMs, endMs });
    setRangeSelectionEnabled(false);
  }, []);

  const dismissErrorBanner = useCallback(() => {
    if (errorMessage) {
      dismissedStatusErrorRef.current = errorMessage;
    }
    setErrorMessage(null);
  }, [errorMessage]);

  useEffect(() => {
    if (!errorMessage) {
      return;
    }
    const timer = window.setTimeout(() => {
      dismissErrorBanner();
    }, BANNER_AUTO_HIDE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [dismissErrorBanner, errorMessage]);

  useEffect(() => {
    if (!settingsNotice) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSettingsNotice(null);
    }, BANNER_AUTO_HIDE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [settingsNotice]);

  const handleMinimizeWindow = useCallback(() => {
    void window.tracer.window.minimize().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to minimize window.");
    });
  }, []);

  const handleToggleMaximizeWindow = useCallback(() => {
    void window.tracer.window
      .toggleMaximize()
      .then((state) => {
        setIsWindowMaximized(state.isMaximized);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to change window size.");
      });
  }, []);

  const handleCloseWindow = useCallback(() => {
    void window.tracer.window.close().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to close window.");
    });
  }, []);

  const actionsLiveLogsFollowEnabled = actionsLiveHoverSyncEnabled && status.state === "capturing";
  const actionsLiveHoverTimelineEnabled = actionsLiveHoverSyncEnabled && status.state !== "capturing";
  const combinedLiveAutoScrollEnabled =
    actionsLiveHoverSyncEnabled && liveScreenshotSyncEnabled && status.state === "capturing";

  useEffect(() => {
    if (!actionsLiveHoverTimelineEnabled) {
      setHoveredActionWindow(null);
    }
  }, [actionsLiveHoverTimelineEnabled]);

  const handleActionsHoverWindow = useCallback(
    (hover: { startMs: number; durationMs: number } | null) => {
      if (!actionsLiveHoverTimelineEnabled) {
        setHoveredActionWindow(null);
        return;
      }
      setHoveredActionWindow(hover);
    },
    [actionsLiveHoverTimelineEnabled]
  );

  return (
    <div className="trace-app">
      {isWindows && (
        <WindowTitleBar
          isMaximized={isWindowMaximized}
          sessionFileName={status.sessionFileName}
          onMinimize={handleMinimizeWindow}
          onToggleMaximize={handleToggleMaximizeWindow}
          onClose={handleCloseWindow}
        />
      )}
      <div className="trace-content">
      <TraceToolbar
        status={status}
        busy={busy}
        pauseResumeSupported={pauseResumeSupported}
        rangeSelectionEnabled={rangeSelectionEnabled}
        hasTimeRangeSelection={selectedTimeRange !== null}
        onLaunch={() => void runAction(() => window.tracer.session.launchBrowser())}
        onLaunchAndCapture={() =>
          void runAction(async () => {
            await window.tracer.session.launchBrowser();
            return window.tracer.session.startCapture();
          })
        }
        onCapture={() => void runAction(() => window.tracer.session.startCapture())}
        onPause={() =>
          void runAction(() => {
            const pauseCapture = window.tracer.session.pauseCapture;
            if (typeof pauseCapture !== "function") {
              throw new Error("Pause/Resume is unavailable in this window. Restart the updated app.");
            }
            return pauseCapture();
          })
        }
        onResume={() =>
          void runAction(() => {
            const resumeCapture = window.tracer.session.resumeCapture;
            if (typeof resumeCapture !== "function") {
              throw new Error("Pause/Resume is unavailable in this window. Restart the updated app.");
            }
            return resumeCapture();
          })
        }
        onStop={() => void runAction(() => window.tracer.session.stopCapture())}
        onSave={() => void runAction(() => window.tracer.session.save())}
        onOpen={() => void runAction(() => window.tracer.session.open())}
        onSettings={() => void openSettings()}
        onToggleRangeSelection={handleToggleRangeSelection}
        onClearRangeSelection={handleClearRangeSelection}
      />

      {(errorMessage || settingsNotice) && (
        <div className="app-banner-stack">
          {errorMessage && (
            <div className="error-banner app-banner">
              <span>{errorMessage}</span>
              <button
                type="button"
                className="banner-close"
                onClick={dismissErrorBanner}
                aria-label="Close message"
              >
                &times;
              </button>
            </div>
          )}
          {settingsNotice && (
            <div className="info-banner app-banner">
              <span>{settingsNotice}</span>
              <button
                type="button"
                className="banner-close"
                onClick={() => setSettingsNotice(null)}
                aria-label="Close message"
              >
                &times;
              </button>
            </div>
          )}
        </div>
      )}

      <FilmstripTimeline
        frames={filmstripFrames}
        selectedEventId={selectedFilmstripEventId}
        totalDurationMs={totalDurationMs}
        maxFrameDurationMs={Math.max(800, (settings?.screenshotIntervalMs ?? 1000) * 2)}
        hoveredWindow={hoveredActionWindow}
        liveHoverSyncEnabled={actionsLiveHoverTimelineEnabled}
        combinedLiveAutoScrollEnabled={combinedLiveAutoScrollEnabled}
        rangeSelectionEnabled={rangeSelectionEnabled}
        selectedRange={selectedTimeRange}
        onSelectEvent={handleSelectFilmstripEvent}
        onRangeChange={handleRangeChange}
      />

      <ResizableSplit
        orientation="horizontal"
        className="workspace-split"
        initialRatio={0.64}
        minPrimarySize={260}
        minSecondarySize={180}
        storageKey="split-workspace"
        primary={
          <ResizableSplit
            orientation="vertical"
            className="trace-main-split"
            initialRatio={0.24}
            minPrimarySize={220}
            minSecondarySize={420}
            storageKey="split-main"
            primary={
              <ActionsPanel
                rows={filteredRows}
                selectedEventId={selectedEventId}
                search={search}
                selectedKinds={selectedKinds}
                liveHoverSyncEnabled={actionsLiveHoverSyncEnabled}
                autoFollowLogs={actionsLiveLogsFollowEnabled}
                onSearchChange={setSearch}
                onToggleKindFilter={handleToggleKindFilter}
                onSetKindFilters={handleSetKindFilters}
                onToggleLiveHoverSync={setActionsLiveHoverSyncEnabled}
                onSelectEvent={handleSelectEvent}
                onHoverWindow={handleActionsHoverWindow}
              />
            }
            secondary={
              <PreviewPanel
                selectedEvent={selectedEvent}
                currentFrame={currentFrame}
                liveScreenshotSyncEnabled={liveScreenshotSyncEnabled}
                onToggleLiveScreenshotSync={handleToggleLiveScreenshotSync}
                toggleDisabled={busy}
              />
            }
          />
        }
        secondary={
          <InspectorTabs
            status={status}
            selectedEvent={selectedEvent}
            logWindow={logTabEvents}
            errorWindow={errorTabEvents}
            consoleWindow={consoleTabEvents}
            networkWindow={networkTabEvents}
            requestChain={requestChain}
          />
        }
      />
      </div>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        busy={settingsBusy}
        errorMessage={settingsError}
        onPickDefaultSaveDir={pickDefaultSaveDir}
        onClose={() => {
          if (!settingsBusy) {
            setSettingsOpen(false);
          }
        }}
        onSave={saveSettings}
      />
    </div>
  );
}
