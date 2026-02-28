import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { formatRelMs } from "../view-model/eventSummaries";
import {
  ACTION_FILTER_OPTIONS,
  ACTION_HTTP_METHOD_FILTER_OPTIONS,
  CONSOLE_LEVEL_FILTER_OPTIONS,
  type ActionFilterKind,
  type ActionHttpMethodFilter,
  type ConsoleLevelFilter
} from "../view-model/timelineMapping";
import type { EventRowViewModel } from "../view-model/types";

const ACTION_ROW_HEIGHT_PX = 58;
const ACTION_ROW_OVERSCAN = 8;

interface ActionsPanelProps {
  rows: EventRowViewModel[];
  selectedEventId: string | null;
  search: string;
  selectedKinds: ActionFilterKind[];
  searchCaseSensitive: boolean;
  regexSearchEnabled: boolean;
  urlFilter: string;
  requestIdFilter: string;
  methodFilter: ActionHttpMethodFilter;
  statusMinFilter: string;
  statusMaxFilter: string;
  timeStartSecFilter: string;
  timeEndSecFilter: string;
  hideStaticAssets: boolean;
  onlyErrorsFilter: boolean;
  consoleLevelFilters: ConsoleLevelFilter[];
  liveHoverSyncEnabled: boolean;
  autoFollowLogs: boolean;
  onSearchChange: (value: string) => void;
  onToggleKindFilter: (kind: ActionFilterKind, selected: boolean) => void;
  onSetKindFilters: (kinds: ActionFilterKind[]) => void;
  onSearchCaseSensitiveChange: (enabled: boolean) => void;
  onRegexSearchChange: (enabled: boolean) => void;
  onUrlFilterChange: (value: string) => void;
  onRequestIdFilterChange: (value: string) => void;
  onMethodFilterChange: (value: ActionHttpMethodFilter) => void;
  onStatusMinFilterChange: (value: string) => void;
  onStatusMaxFilterChange: (value: string) => void;
  onTimeStartSecFilterChange: (value: string) => void;
  onTimeEndSecFilterChange: (value: string) => void;
  onHideStaticAssetsChange: (enabled: boolean) => void;
  onOnlyErrorsFilterChange: (enabled: boolean) => void;
  onToggleConsoleLevelFilter: (level: ConsoleLevelFilter, selected: boolean) => void;
  onSetConsoleLevelFilters: (levels: ConsoleLevelFilter[]) => void;
  onClearAdvancedFilters: () => void;
  onToggleLiveHoverSync: (enabled: boolean) => void;
  onSelectEvent: (eventId: string) => void;
  onHoverWindow: (hover: { startMs: number; durationMs: number } | null) => void;
}

export function ActionsPanel({
  rows,
  selectedEventId,
  search,
  selectedKinds,
  searchCaseSensitive,
  regexSearchEnabled,
  urlFilter,
  requestIdFilter,
  methodFilter,
  statusMinFilter,
  statusMaxFilter,
  timeStartSecFilter,
  timeEndSecFilter,
  hideStaticAssets,
  onlyErrorsFilter,
  consoleLevelFilters,
  liveHoverSyncEnabled,
  autoFollowLogs,
  onSearchChange,
  onToggleKindFilter,
  onSetKindFilters,
  onSearchCaseSensitiveChange,
  onRegexSearchChange,
  onUrlFilterChange,
  onRequestIdFilterChange,
  onMethodFilterChange,
  onStatusMinFilterChange,
  onStatusMaxFilterChange,
  onTimeStartSecFilterChange,
  onTimeEndSecFilterChange,
  onHideStaticAssetsChange,
  onOnlyErrorsFilterChange,
  onToggleConsoleLevelFilter,
  onSetConsoleLevelFilters,
  onClearAdvancedFilters,
  onToggleLiveHoverSync,
  onSelectEvent,
  onHoverWindow
}: ActionsPanelProps): JSX.Element {
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const filterDropdownRef = useRef<HTMLDetailsElement | null>(null);
  const advancedFilterDropdownRef = useRef<HTMLDetailsElement | null>(null);
  const prevRowsCountRef = useRef(0);
  const wasAutoFollowRef = useRef(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const badgeClassFor = (badge: string): string => `row-badge-${badge.toLowerCase()}`;
  const selectedSummary = ACTION_FILTER_OPTIONS.filter((kind) => selectedKinds.includes(kind));
  const summaryLabel =
    selectedSummary.length === 0
      ? "none"
      : selectedSummary.length === ACTION_FILTER_OPTIONS.length
        ? "all"
        : selectedSummary.join(", ");
  const allSelected = selectedKinds.length === ACTION_FILTER_OPTIONS.length;
  const allConsoleLevelsSelected = consoleLevelFilters.length === CONSOLE_LEVEL_FILTER_OPTIONS.length;
  const advancedFiltersCount =
    (searchCaseSensitive ? 1 : 0) +
    (regexSearchEnabled ? 1 : 0) +
    (urlFilter.trim() ? 1 : 0) +
    (requestIdFilter.trim() ? 1 : 0) +
    (methodFilter !== "all" ? 1 : 0) +
    (statusMinFilter.trim() ? 1 : 0) +
    (statusMaxFilter.trim() ? 1 : 0) +
    (timeStartSecFilter.trim() ? 1 : 0) +
    (timeEndSecFilter.trim() ? 1 : 0) +
    (hideStaticAssets ? 1 : 0) +
    (onlyErrorsFilter ? 1 : 0) +
    (allConsoleLevelsSelected ? 0 : 1);
  const advancedSummaryLabel =
    advancedFiltersCount > 0 ? `Filters (${advancedFiltersCount})` : "Filters";
  const selectedRowIndex = useMemo(() => {
    if (!selectedEventId) {
      return -1;
    }
    return rows.findIndex((row) => row.id === selectedEventId);
  }, [rows, selectedEventId]);
  const totalHeight = rows.length * ACTION_ROW_HEIGHT_PX;
  const safeViewportHeight = Math.max(1, viewportHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / ACTION_ROW_HEIGHT_PX) - ACTION_ROW_OVERSCAN);
  const endIndex = Math.min(
    rows.length,
    Math.ceil((scrollTop + safeViewportHeight) / ACTION_ROW_HEIGHT_PX) + ACTION_ROW_OVERSCAN
  );
  const visibleRows = rows.slice(startIndex, endIndex);
  const offsetY = startIndex * ACTION_ROW_HEIGHT_PX;

  useEffect(() => {
    const list = listRef.current;
    if (!list || selectedRowIndex < 0) {
      return;
    }
    const rowTop = selectedRowIndex * ACTION_ROW_HEIGHT_PX;
    const rowBottom = rowTop + ACTION_ROW_HEIGHT_PX;
    const viewportTop = list.scrollTop;
    const viewportBottom = viewportTop + list.clientHeight;
    if (rowTop >= viewportTop && rowBottom <= viewportBottom) {
      return;
    }
    const targetTop = Math.max(
      0,
      rowTop - Math.max(0, Math.floor((list.clientHeight - ACTION_ROW_HEIGHT_PX) / 2))
    );
    list.scrollTo({
      top: targetTop,
      behavior: "smooth"
    });
  }, [selectedRowIndex]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const updateViewport = (): void => {
      setViewportHeight(list.clientHeight);
    };

    updateViewport();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewport);
      return () => {
        window.removeEventListener("resize", updateViewport);
      };
    }

    const observer = new ResizeObserver(() => {
      updateViewport();
    });
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const maxScroll = Math.max(0, totalHeight - list.clientHeight);
    if (list.scrollTop <= maxScroll) {
      return;
    }
    list.scrollTop = maxScroll;
    setScrollTop(maxScroll);
  }, [totalHeight, viewportHeight]);

  useEffect(() => {
    if (!selectAllRef.current) {
      return;
    }
    selectAllRef.current.indeterminate = !allSelected && selectedKinds.length > 0;
  }, [allSelected, selectedKinds.length]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      const dropdown = filterDropdownRef.current;
      const advancedDropdown = advancedFilterDropdownRef.current;
      const target = event.target;

      if (dropdown?.open) {
        if (target instanceof Node && dropdown.contains(target)) {
          return;
        }
        dropdown.open = false;
      }

      if (advancedDropdown?.open) {
        if (target instanceof Node && advancedDropdown.contains(target)) {
          return;
        }
        advancedDropdown.open = false;
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      const dropdown = filterDropdownRef.current;
      if (dropdown?.open) {
        dropdown.open = false;
      }
      const advancedDropdown = advancedFilterDropdownRef.current;
      if (advancedDropdown?.open) {
        advancedDropdown.open = false;
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const wasAutoFollow = wasAutoFollowRef.current;
    wasAutoFollowRef.current = autoFollowLogs;

    const prevCount = prevRowsCountRef.current;
    prevRowsCountRef.current = rows.length;

    if (!autoFollowLogs || !listRef.current) {
      return;
    }

    const justEnabled = !wasAutoFollow;
    const hasNewRows = rows.length > prevCount;
    if (!justEnabled && !hasNewRows) {
      return;
    }

    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [autoFollowLogs, rows.length]);

  const handleListScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  return (
    <aside className="actions-panel">
      <header className="actions-header">
        <div className="actions-header-main">
          <h2>Actions</h2>
          <label className="actions-live-toggle">
            <input
              type="checkbox"
              checked={liveHoverSyncEnabled}
              onChange={(event) => onToggleLiveHoverSync(event.target.checked)}
            />
            <span>Live</span>
          </label>
        </div>
        <div className="actions-filters">
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search events, text, URL..."
          />
          <details className="actions-filter-dropdown" ref={filterDropdownRef}>
            <summary className="actions-filter-summary">{summaryLabel}</summary>
            <div className="actions-filter-menu">
              <label className="actions-kind-check actions-kind-select-all">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                    checked={allSelected}
                    onChange={(event) => {
                      if (event.target.checked) {
                        onSetKindFilters(ACTION_FILTER_OPTIONS);
                        return;
                      }
                      onSetKindFilters([]);
                  }}
                />
                <span>Select all</span>
              </label>
              <div className="actions-filter-divider" />
              {ACTION_FILTER_OPTIONS.map((kind) => {
                const checked = selectedKinds.includes(kind);
                return (
                  <label key={kind} className="actions-kind-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => onToggleKindFilter(kind, event.target.checked)}
                    />
                    <span>{kind}</span>
                  </label>
                );
              })}
            </div>
          </details>
          <details className="actions-filter-dropdown actions-filter-dropdown-advanced" ref={advancedFilterDropdownRef}>
            <summary className="actions-filter-summary">{advancedSummaryLabel}</summary>
            <div className="actions-filter-menu actions-advanced-filter-menu">
              <div className="actions-advanced-grid">
                <label className="actions-filter-field">
                  <span>URL contains</span>
                  <input
                    value={urlFilter}
                    onChange={(event) => onUrlFilterChange(event.target.value)}
                    placeholder="api.example.com/path"
                  />
                </label>
                <label className="actions-filter-field">
                  <span>Request ID contains</span>
                  <input
                    value={requestIdFilter}
                    onChange={(event) => onRequestIdFilterChange(event.target.value)}
                    placeholder="29892.333"
                  />
                </label>
                <label className="actions-filter-field">
                  <span>Method</span>
                  <select
                    value={methodFilter}
                    onChange={(event) =>
                      onMethodFilterChange(event.target.value as ActionHttpMethodFilter)
                    }
                  >
                    {ACTION_HTTP_METHOD_FILTER_OPTIONS.map((method) => (
                      <option key={method} value={method}>
                        {method === "all" ? "all methods" : method}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="actions-filter-field">
                  <span>Status min</span>
                  <input
                    value={statusMinFilter}
                    onChange={(event) => onStatusMinFilterChange(event.target.value)}
                    placeholder="200"
                    inputMode="numeric"
                  />
                </label>
                <label className="actions-filter-field">
                  <span>Status max</span>
                  <input
                    value={statusMaxFilter}
                    onChange={(event) => onStatusMaxFilterChange(event.target.value)}
                    placeholder="599"
                    inputMode="numeric"
                  />
                </label>
                <label className="actions-filter-field">
                  <span>From (s)</span>
                  <input
                    value={timeStartSecFilter}
                    onChange={(event) => onTimeStartSecFilterChange(event.target.value)}
                    placeholder="0.0"
                    inputMode="decimal"
                  />
                </label>
                <label className="actions-filter-field">
                  <span>To (s)</span>
                  <input
                    value={timeEndSecFilter}
                    onChange={(event) => onTimeEndSecFilterChange(event.target.value)}
                    placeholder="12.5"
                    inputMode="decimal"
                  />
                </label>
              </div>

              <div className="actions-filter-toggles">
                <label className="actions-check-option">
                  <input
                    type="checkbox"
                    checked={onlyErrorsFilter}
                    onChange={(event) => onOnlyErrorsFilterChange(event.target.checked)}
                  />
                  <span>Only errors</span>
                </label>
                <label className="actions-check-option">
                  <input
                    type="checkbox"
                    checked={hideStaticAssets}
                    onChange={(event) => onHideStaticAssetsChange(event.target.checked)}
                  />
                  <span>Hide static assets (image/css/js/font)</span>
                </label>
                <label className="actions-check-option">
                  <input
                    type="checkbox"
                    checked={searchCaseSensitive}
                    onChange={(event) => onSearchCaseSensitiveChange(event.target.checked)}
                  />
                  <span>Case sensitive search</span>
                </label>
                <label className="actions-check-option">
                  <input
                    type="checkbox"
                    checked={regexSearchEnabled}
                    onChange={(event) => onRegexSearchChange(event.target.checked)}
                  />
                  <span>Regex search</span>
                </label>
              </div>

              <div className="actions-console-levels">
                <span>Console levels</span>
                <div className="actions-level-chip-row">
                  {CONSOLE_LEVEL_FILTER_OPTIONS.map((level) => {
                    const selected = consoleLevelFilters.includes(level);
                    return (
                      <button
                        key={level}
                        type="button"
                        className={`actions-level-chip ${selected ? "active" : ""}`}
                        onClick={() => onToggleConsoleLevelFilter(level, !selected)}
                      >
                        {level}
                      </button>
                    );
                  })}
                </div>
                <div className="actions-level-chip-actions">
                  <button
                    type="button"
                    onClick={() => onSetConsoleLevelFilters(CONSOLE_LEVEL_FILTER_OPTIONS)}
                  >
                    All levels
                  </button>
                  <button type="button" onClick={() => onSetConsoleLevelFilters([])}>
                    None
                  </button>
                </div>
              </div>

              <div className="actions-advanced-actions">
                <button type="button" onClick={onClearAdvancedFilters}>
                  Clear advanced filters
                </button>
              </div>
            </div>
          </details>
        </div>
      </header>

      <div
        className="actions-list"
        ref={listRef}
        onScroll={handleListScroll}
        onMouseLeave={() => onHoverWindow(null)}
      >
        {rows.length === 0 && <p className="empty-state">No events found</p>}
        {rows.length > 0 && (
          <div className="actions-list-spacer" style={{ height: `${totalHeight}px` }}>
            <div
              className="actions-list-window"
              style={{ transform: `translateY(${offsetY}px)` }}
            >
              {visibleRows.map((row) => {
                const selected = row.id === selectedEventId;
                return (
                  <button
                    key={row.id}
                    className={`action-row ${selected ? "selected" : ""}`}
                    onClick={() => onSelectEvent(row.id)}
                    onMouseEnter={() =>
                      onHoverWindow({ startMs: row.relMs, durationMs: row.durationMs })
                    }
                    onFocus={() =>
                      onHoverWindow({ startMs: row.relMs, durationMs: row.durationMs })
                    }
                    onBlur={() => onHoverWindow(null)}
                  >
                    <span className={`row-badge ${badgeClassFor(row.badge)}`}>{row.badge}</span>
                    <span className="row-main">
                      <span className="row-title">{row.title}</span>
                      <span className="row-subtitle">{row.subtitle}</span>
                    </span>
                    <span className="row-meta">
                      <span>{formatRelMs(row.deltaMs)}</span>
                      <span>{row.clockLabel}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
