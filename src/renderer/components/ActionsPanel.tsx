import { useEffect, useRef } from "react";
import { formatRelMs } from "../view-model/eventSummaries";
import { ACTION_FILTER_OPTIONS, type ActionFilterKind } from "../view-model/timelineMapping";
import type { EventRowViewModel } from "../view-model/types";

interface ActionsPanelProps {
  rows: EventRowViewModel[];
  selectedEventId: string | null;
  search: string;
  selectedKinds: ActionFilterKind[];
  liveHoverSyncEnabled: boolean;
  autoFollowLogs: boolean;
  onSearchChange: (value: string) => void;
  onToggleKindFilter: (kind: ActionFilterKind, selected: boolean) => void;
  onSetKindFilters: (kinds: ActionFilterKind[]) => void;
  onToggleLiveHoverSync: (enabled: boolean) => void;
  onSelectEvent: (eventId: string) => void;
  onHoverWindow: (hover: { startMs: number; durationMs: number } | null) => void;
}

export function ActionsPanel({
  rows,
  selectedEventId,
  search,
  selectedKinds,
  liveHoverSyncEnabled,
  autoFollowLogs,
  onSearchChange,
  onToggleKindFilter,
  onSetKindFilters,
  onToggleLiveHoverSync,
  onSelectEvent,
  onHoverWindow
}: ActionsPanelProps): JSX.Element {
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const filterDropdownRef = useRef<HTMLDetailsElement | null>(null);
  const prevRowsCountRef = useRef(0);
  const wasAutoFollowRef = useRef(false);
  const badgeClassFor = (badge: string): string => `row-badge-${badge.toLowerCase()}`;
  const selectedSummary = ACTION_FILTER_OPTIONS.filter((kind) => selectedKinds.includes(kind));
  const summaryLabel =
    selectedSummary.length === 0
      ? "none"
      : selectedSummary.length === ACTION_FILTER_OPTIONS.length
        ? "all"
        : selectedSummary.join(", ");
  const allSelected = selectedKinds.length === ACTION_FILTER_OPTIONS.length;

  useEffect(() => {
    if (!selectedRowRef.current) {
      return;
    }
    selectedRowRef.current.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }, [selectedEventId]);

  useEffect(() => {
    if (!selectAllRef.current) {
      return;
    }
    selectAllRef.current.indeterminate = !allSelected && selectedKinds.length > 0;
  }, [allSelected, selectedKinds.length]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      const dropdown = filterDropdownRef.current;
      if (!dropdown || !dropdown.open) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && dropdown.contains(target)) {
        return;
      }
      dropdown.open = false;
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      const dropdown = filterDropdownRef.current;
      if (dropdown?.open) {
        dropdown.open = false;
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
            placeholder="Search events..."
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
        </div>
      </header>

      <div className="actions-list" ref={listRef} onMouseLeave={() => onHoverWindow(null)}>
        {rows.length === 0 && <p className="empty-state">No events found</p>}
        {rows.map((row) => {
          const selected = row.id === selectedEventId;
          return (
            <button
              key={row.id}
              ref={selected ? selectedRowRef : null}
              className={`action-row ${selected ? "selected" : ""}`}
              onClick={() => onSelectEvent(row.id)}
              onMouseEnter={() => onHoverWindow({ startMs: row.relMs, durationMs: row.durationMs })}
              onFocus={() => onHoverWindow({ startMs: row.relMs, durationMs: row.durationMs })}
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
    </aside>
  );
}
