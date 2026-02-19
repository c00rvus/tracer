import { useEffect, useMemo, useRef, useState } from "react";
import type { CaptureEvent } from "../../shared/types";
import { ResizableSplit } from "./ResizableSplit";
import { eventTitle, formatRelMs } from "../view-model/eventSummaries";

type InspectorTab = "call" | "log" | "errors" | "console" | "network";
type NetworkDetailTab = "headers" | "payload" | "preview" | "response" | "initiator" | "timing";

interface InspectorTabsProps {
  selectedEvent: CaptureEvent | null;
  logWindow: CaptureEvent[];
  errorWindow: CaptureEvent[];
  consoleWindow: CaptureEvent[];
  networkWindow: CaptureEvent[];
  liveSyncEnabled: boolean;
  onToggleLiveSync: (enabled: boolean) => void;
}

interface NetworkEntry {
  requestId: string;
  method: string;
  url: string;
  resourceType?: string;
  status?: number;
  statusText?: string;
  failed: boolean;
  canceled?: boolean;
  errorText?: string;
  mimeType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;
  bodyPath?: string;
  startedTsMs?: number;
  finishedTsMs?: number;
  durationMs?: number;
  events: CaptureEvent[];
}

const NETWORK_DETAIL_TABS: Array<{ id: NetworkDetailTab; label: string }> = [
  { id: "headers", label: "Headers" },
  { id: "payload", label: "Payload" },
  { id: "preview", label: "Preview" },
  { id: "response", label: "Response" },
  { id: "initiator", label: "Initiator" },
  { id: "timing", label: "Timing" }
];

function tabForSelectedEvent(event: CaptureEvent | null): InspectorTab {
  if (!event) {
    return "call";
  }
  if (
    event.kind === "network_request" ||
    event.kind === "network_response" ||
    event.kind === "network_fail"
  ) {
    return "network";
  }
  if (event.kind === "console") {
    if (event.level === "error") {
      return "errors";
    }
    return "console";
  }
  if (event.kind === "lifecycle") {
    return "log";
  }
  return "call";
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

function formatClock(tsMs?: number): string {
  if (!tsMs) {
    return "-";
  }
  return new Date(tsMs).toLocaleTimeString();
}

function getHeaderValue(headers: Record<string, string> | undefined, headerName: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  const target = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function getQueryParams(url: string): Record<string, string> {
  try {
    const parsed = new URL(url);
    const pairs = Array.from(parsed.searchParams.entries());
    if (pairs.length === 0) {
      return {};
    }
    return pairs.reduce<Record<string, string>>((acc, [key, value]) => {
      if (acc[key]) {
        acc[key] = `${acc[key]}, ${value}`;
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function tryFormatPayload(rawPayload?: string): string {
  if (!rawPayload || rawPayload.trim().length === 0) {
    return "No request payload captured";
  }
  try {
    return JSON.stringify(JSON.parse(rawPayload), null, 2);
  } catch {
    return rawPayload;
  }
}

function toKeyValueRows(headers?: Record<string, string>, emptyLabel = "No headers"): JSX.Element {
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }
  return (
    <div className="kv-list">
      {entries.map(([key, value]) => (
        <div key={`${key}-${value}`} className="kv-row">
          <span className="kv-key">{key}</span>
          <span className="kv-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

function buildNetworkEntries(events: CaptureEvent[]): NetworkEntry[] {
  const map = new Map<string, NetworkEntry>();
  const firstSeenIndexByRequestId = new Map<string, number>();

  const ensureEntry = (requestId: string): NetworkEntry => {
    const existing = map.get(requestId);
    if (existing) {
      return existing;
    }
    const entry: NetworkEntry = {
      requestId,
      method: "UNKNOWN",
      url: "",
      failed: false,
      events: []
    };
    map.set(requestId, entry);
    return entry;
  };

  for (const [index, event] of events.entries()) {
    if (
      event.kind !== "network_request" &&
      event.kind !== "network_response" &&
      event.kind !== "network_fail"
    ) {
      continue;
    }
    if (!firstSeenIndexByRequestId.has(event.requestId)) {
      firstSeenIndexByRequestId.set(event.requestId, index);
    }
    const entry = ensureEntry(event.requestId);
    entry.events.push(event);

    if (event.kind === "network_request") {
      entry.method = event.method;
      entry.url = event.url;
      entry.resourceType = event.resourceType;
      entry.requestHeaders = event.headers;
      entry.postData = event.postData;
      entry.startedTsMs = entry.startedTsMs ?? event.tsMs;
      continue;
    }

    if (event.kind === "network_response") {
      entry.status = event.status;
      entry.statusText = event.statusText;
      entry.responseHeaders = event.headers;
      entry.mimeType = event.mimeType;
      entry.bodyPath = event.bodyPath;
      entry.finishedTsMs = event.tsMs;
      continue;
    }

    entry.failed = true;
    entry.canceled = event.canceled;
    entry.errorText = event.errorText;
    entry.url = entry.url || event.url || "";
    entry.finishedTsMs = event.tsMs;
  }

  const entries = Array.from(map.values());
  for (const entry of entries) {
    entry.events.sort((a, b) => {
      if (a.tsMs !== b.tsMs) {
        return a.tsMs - b.tsMs;
      }
      if (a.tRelMs !== b.tRelMs) {
        return a.tRelMs - b.tRelMs;
      }
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" });
    });
    if (!entry.startedTsMs) {
      entry.startedTsMs = entry.events[0]?.tsMs;
    }
    if (!entry.finishedTsMs) {
      entry.finishedTsMs = entry.events[entry.events.length - 1]?.tsMs;
    }
    if (entry.startedTsMs && entry.finishedTsMs) {
      entry.durationMs = Math.max(0, entry.finishedTsMs - entry.startedTsMs);
    }
  }

  const toRequestOrder = (requestId: string): number | null => {
    const numeric = Number(requestId);
    return Number.isFinite(numeric) ? numeric : null;
  };

  return entries.sort((a, b) => {
    const aFirstIndex = firstSeenIndexByRequestId.get(a.requestId);
    const bFirstIndex = firstSeenIndexByRequestId.get(b.requestId);
    if (typeof aFirstIndex === "number" && typeof bFirstIndex === "number" && aFirstIndex !== bFirstIndex) {
      return aFirstIndex - bFirstIndex;
    }

    const aStart = a.startedTsMs ?? 0;
    const bStart = b.startedTsMs ?? 0;
    if (aStart !== bStart) {
      // Keep the same chronological direction as Actions/timeline.
      return aStart - bStart;
    }

    const aFirstTs = a.events[0]?.tsMs ?? aStart;
    const bFirstTs = b.events[0]?.tsMs ?? bStart;
    if (aFirstTs !== bFirstTs) {
      return aFirstTs - bFirstTs;
    }

    const aReqOrder = toRequestOrder(a.requestId);
    const bReqOrder = toRequestOrder(b.requestId);
    if (aReqOrder !== null && bReqOrder !== null && aReqOrder !== bReqOrder) {
      return aReqOrder - bReqOrder;
    }

    return a.requestId.localeCompare(b.requestId, undefined, { numeric: true, sensitivity: "base" });
  });
}

function EventMasterList({
  events,
  selectedId,
  onSelect
}: {
  events: CaptureEvent[];
  selectedId: string | null;
  onSelect: (eventId: string) => void;
}): JSX.Element {
  if (events.length === 0) {
    return <div className="empty-state">No events</div>;
  }
  return (
    <div className="inspector-master-list">
      {events.map((event) => (
        <button
          key={event.id}
          className={`inspector-master-row ${selectedId === event.id ? "selected" : ""}`}
          onClick={() => onSelect(event.id)}
        >
          <span className="master-title">{eventTitle(event)}</span>
          <span className="master-subtitle">
            {event.kind === "console" && event.text}
            {event.kind === "network_request" && `${event.method} ${event.url}`}
            {event.kind === "network_response" && `${event.status} ${event.statusText}`}
            {event.kind === "network_fail" && event.errorText}
            {event.kind === "screenshot" && event.path}
            {event.kind === "lifecycle" && event.action}
          </span>
          <small>{formatRelMs(event.tRelMs)}</small>
        </button>
      ))}
    </div>
  );
}

function EventDetail({ event }: { event: CaptureEvent | null }): JSX.Element {
  if (!event) {
    return <div className="empty-state">Select an item to inspect details.</div>;
  }
  return (
    <div className="inspector-detail-panel">
      <div className="detail-badges">
        <span>kind: {event.kind}</span>
        <span>relative: {formatRelMs(event.tRelMs)}</span>
        <span>time: {formatClock(event.tsMs)}</span>
      </div>

      {event.kind === "console" && (
        <>
          <h4>Console Message</h4>
          <pre>{event.text}</pre>
          <h4>Args</h4>
          <pre>{event.argsJson ?? "No args captured"}</pre>
        </>
      )}

      {event.kind === "network_request" && (
        <>
          <h4>Request</h4>
          <pre>{`${event.method} ${event.url}`}</pre>
          <h4>Headers</h4>
          {toKeyValueRows(event.headers)}
          <h4>Payload</h4>
          <pre>{event.postData ?? "No post body captured"}</pre>
        </>
      )}

      {event.kind === "network_response" && (
        <>
          <h4>Response</h4>
          <pre>{`${event.status} ${event.statusText}`}</pre>
          <h4>Headers</h4>
          {toKeyValueRows(event.headers)}
          <h4>Body</h4>
          <pre>{event.bodyPath ? `Saved at: ${event.bodyPath}` : "Response body not captured"}</pre>
        </>
      )}

      {event.kind === "network_fail" && (
        <>
          <h4>Failure</h4>
          <pre>{event.errorText}</pre>
          <pre>{`Canceled: ${event.canceled ? "yes" : "no"}`}</pre>
        </>
      )}

      <h4>Raw Event</h4>
      <pre>{formatJson(event)}</pre>
    </div>
  );
}

function TabSplit({
  storageKey,
  master,
  detail
}: {
  storageKey: string;
  master: JSX.Element;
  detail: JSX.Element;
}): JSX.Element {
  return (
    <ResizableSplit
      orientation="vertical"
      className="inspector-split"
      initialRatio={0.34}
      minPrimarySize={220}
      minSecondarySize={260}
      storageKey={storageKey}
      primary={master}
      secondary={detail}
    />
  );
}

function NetworkInspector({
  entries,
  selectedRequestId,
  onSelectRequest
}: {
  entries: NetworkEntry[];
  selectedRequestId: string | null;
  onSelectRequest: (requestId: string) => void;
}): JSX.Element {
  const [activeDetailTab, setActiveDetailTab] = useState<NetworkDetailTab>("headers");
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  const selectedEntry = entries.find((entry) => entry.requestId === selectedRequestId) ?? entries[0] ?? null;
  const requestEvent = selectedEntry?.events.find((event) => event.kind === "network_request");
  const responseEvent = selectedEntry?.events.find((event) => event.kind === "network_response");
  const failedEvent = selectedEntry?.events.find((event) => event.kind === "network_fail");
  const queryParams = selectedEntry ? getQueryParams(selectedEntry.url) : {};
  const requestPayload = tryFormatPayload(selectedEntry?.postData);
  const statusLabel = selectedEntry?.status
    ? `${selectedEntry.status} ${selectedEntry.statusText ?? ""}`.trim()
    : selectedEntry?.failed
      ? "Failed"
      : "Pending";
  const initiatedRelMs = requestEvent?.tRelMs ?? selectedEntry?.events[0]?.tRelMs;
  const responseRelMs = responseEvent?.tRelMs;
  const finishedRelMs = selectedEntry?.events[selectedEntry.events.length - 1]?.tRelMs;

  useEffect(() => {
    if (!selectedRequestId && entries[0]) {
      onSelectRequest(entries[0].requestId);
      return;
    }
    if (selectedRequestId && !entries.some((entry) => entry.requestId === selectedRequestId) && entries[0]) {
      onSelectRequest(entries[0].requestId);
    }
  }, [entries, onSelectRequest, selectedRequestId]);

  useEffect(() => {
    if (!selectedRowRef.current) {
      return;
    }
    selectedRowRef.current.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }, [selectedEntry?.requestId]);

  if (entries.length === 0) {
    return <div className="empty-state">No network requests available.</div>;
  }

  return (
    <TabSplit
      storageKey="split-inspector-network"
      master={
        <div className="inspector-master-list">
          {entries.map((entry) => (
            <button
              key={entry.requestId}
              ref={entry.requestId === selectedEntry?.requestId ? selectedRowRef : null}
              className={`inspector-master-row ${entry.requestId === selectedEntry?.requestId ? "selected" : ""}`}
              onClick={() => onSelectRequest(entry.requestId)}
              aria-selected={entry.requestId === selectedEntry?.requestId}
            >
              <span className="master-title">
                {entry.method} {entry.status ? `${entry.status}` : entry.failed ? "FAILED" : ""}
              </span>
              <span className="master-subtitle">{entry.url || entry.requestId}</span>
              <small>
                {entry.durationMs !== undefined ? `${entry.durationMs}ms` : "-"} | {formatClock(entry.startedTsMs)}
              </small>
            </button>
          ))}
        </div>
      }
      detail={
        <div className="inspector-detail-panel network-detail-panel">
          {selectedEntry && (
            <div className="network-detail-layout">
              <div className="detail-badges network-summary-badges">
                <span>requestId: {selectedEntry.requestId}</span>
                <span>status: {statusLabel}</span>
                <span>duration: {selectedEntry.durationMs !== undefined ? `${selectedEntry.durationMs}ms` : "-"}</span>
              </div>

              <nav className="network-detail-tabs">
                {NETWORK_DETAIL_TABS.map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    className={activeDetailTab === tab.id ? "active" : ""}
                    onClick={() => setActiveDetailTab(tab.id)}
                  >
                    <span>{tab.label}</span>
                  </button>
                ))}
              </nav>

              <div className="network-detail-content">
                {activeDetailTab === "headers" && (
                  <div className="network-tab-panel">
                    <h4>General</h4>
                    {toKeyValueRows({
                      "Request URL": selectedEntry.url || "-",
                      "Request Method": selectedEntry.method,
                      "Status Code": statusLabel,
                      "Resource Type": selectedEntry.resourceType ?? "-",
                      "MIME Type": selectedEntry.mimeType ?? "-"
                    })}

                    <h4>Request Headers</h4>
                    {toKeyValueRows(selectedEntry.requestHeaders, "No request headers")}

                    <h4>Response Headers</h4>
                    {toKeyValueRows(selectedEntry.responseHeaders, "No response headers")}
                  </div>
                )}

                {activeDetailTab === "payload" && (
                  <div className="network-tab-panel">
                    <h4>Query String Parameters</h4>
                    {toKeyValueRows(queryParams, "No query string parameters")}

                    <h4>Request Payload</h4>
                    <pre>{requestPayload}</pre>
                  </div>
                )}

                {activeDetailTab === "preview" && (
                  <div className="network-tab-panel">
                    <h4>Preview</h4>
                    {selectedEntry.bodyPath ? (
                      <>
                        <p className="network-note">
                          Response body file captured. Use the saved path below to inspect the content.
                        </p>
                        <pre>{selectedEntry.bodyPath}</pre>
                      </>
                    ) : (
                      <p className="network-note">
                        No inline preview available. This request did not persist a response body.
                      </p>
                    )}

                    <h4>Detected Content Type</h4>
                    <pre>{selectedEntry.mimeType ?? getHeaderValue(selectedEntry.responseHeaders, "content-type") ?? "-"}</pre>
                  </div>
                )}

                {activeDetailTab === "response" && (
                  <div className="network-tab-panel">
                    <h4>Status</h4>
                    <pre>{statusLabel}</pre>

                    <h4>Response Body</h4>
                    <pre>{selectedEntry.bodyPath ? `Saved at: ${selectedEntry.bodyPath}` : "Response body not captured"}</pre>

                    {selectedEntry.errorText && (
                      <>
                        <h4>Failure Reason</h4>
                        <pre>{selectedEntry.errorText}</pre>
                      </>
                    )}
                  </div>
                )}

                {activeDetailTab === "initiator" && (
                  <div className="network-tab-panel">
                    <h4>Initiator</h4>
                    {toKeyValueRows({
                      Page: requestEvent?.pageUrl ?? selectedEntry.events[0]?.pageUrl ?? "-",
                      Referrer: getHeaderValue(selectedEntry.requestHeaders, "referer") ?? "-",
                      "Started At": formatClock(selectedEntry.startedTsMs),
                      "Started (relative)": typeof initiatedRelMs === "number" ? formatRelMs(initiatedRelMs) : "-"
                    })}

                    <h4>Event Chain</h4>
                    <div className="network-chain-list">
                      {selectedEntry.events.map((event) => (
                        <div key={event.id} className="network-chain-row">
                          <span>{event.kind}</span>
                          <span>{formatRelMs(event.tRelMs)}</span>
                          <span>{formatClock(event.tsMs)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeDetailTab === "timing" && (
                  <div className="network-tab-panel">
                    <h4>Timing</h4>
                    {toKeyValueRows({
                      "Start Time": formatClock(selectedEntry.startedTsMs),
                      "Response Time": responseEvent ? formatClock(responseEvent.tsMs) : "-",
                      "End Time": formatClock(selectedEntry.finishedTsMs),
                      Duration: selectedEntry.durationMs !== undefined ? `${selectedEntry.durationMs}ms` : "-"
                    })}

                    <h4>Relative Timeline</h4>
                    <div className="network-chain-list">
                      <div className="network-chain-row">
                        <span>Request started</span>
                        <span>{typeof initiatedRelMs === "number" ? formatRelMs(initiatedRelMs) : "-"}</span>
                        <span>{formatClock(selectedEntry.startedTsMs)}</span>
                      </div>
                      <div className="network-chain-row">
                        <span>Response received</span>
                        <span>{typeof responseRelMs === "number" ? formatRelMs(responseRelMs) : "-"}</span>
                        <span>{responseEvent ? formatClock(responseEvent.tsMs) : "-"}</span>
                      </div>
                      <div className="network-chain-row">
                        <span>{selectedEntry.failed ? "Request failed" : "Request finished"}</span>
                        <span>{typeof finishedRelMs === "number" ? formatRelMs(finishedRelMs) : "-"}</span>
                        <span>{formatClock(selectedEntry.finishedTsMs)}</span>
                      </div>
                    </div>

                    {failedEvent?.kind === "network_fail" && (
                      <>
                        <h4>Failure</h4>
                        <pre>{failedEvent.errorText}</pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}

export function InspectorTabs({
  selectedEvent,
  logWindow,
  errorWindow,
  consoleWindow,
  networkWindow,
  liveSyncEnabled,
  onToggleLiveSync
}: InspectorTabsProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<InspectorTab>("call");
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null);
  const [selectedConsoleId, setSelectedConsoleId] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const syncedActionEventIdRef = useRef<string | null>(null);

  const networkEntries = useMemo(() => buildNetworkEntries(networkWindow), [networkWindow]);
  const selectedLogEvent = logWindow.find((event) => event.id === selectedLogId) ?? logWindow[0] ?? null;
  const selectedErrorEvent = errorWindow.find((event) => event.id === selectedErrorId) ?? errorWindow[0] ?? null;
  const selectedConsoleEvent =
    consoleWindow.find((event) => event.id === selectedConsoleId) ?? consoleWindow[0] ?? null;

  useEffect(() => {
    if (logWindow.length > 0 && !selectedLogId) {
      setSelectedLogId(logWindow[0].id);
    }
  }, [logWindow, selectedLogId]);

  useEffect(() => {
    if (errorWindow.length > 0 && !selectedErrorId) {
      setSelectedErrorId(errorWindow[0].id);
    }
  }, [errorWindow, selectedErrorId]);

  useEffect(() => {
    syncedActionEventIdRef.current = null;
  }, [liveSyncEnabled]);

  useEffect(() => {
    if (!selectedEvent) {
      syncedActionEventIdRef.current = null;
      return;
    }

    if (syncedActionEventIdRef.current === selectedEvent.id) {
      return;
    }
    syncedActionEventIdRef.current = selectedEvent.id;

    setSelectedLogId(selectedEvent.id);
    if (!liveSyncEnabled) {
      setActiveTab("call");
      return;
    }

    setActiveTab(tabForSelectedEvent(selectedEvent));

    if (selectedEvent.kind === "console") {
      setSelectedConsoleId(selectedEvent.id);
      if (selectedEvent.level === "error") {
        setSelectedErrorId(selectedEvent.id);
      }
      return;
    }

    if (
      selectedEvent.kind === "network_request" ||
      selectedEvent.kind === "network_response" ||
      selectedEvent.kind === "network_fail"
    ) {
      setSelectedRequestId(selectedEvent.requestId);
    }
  }, [liveSyncEnabled, selectedEvent]);

  useEffect(() => {
    if (consoleWindow.length > 0 && !selectedConsoleId) {
      setSelectedConsoleId(consoleWindow[0].id);
    }
  }, [consoleWindow, selectedConsoleId]);

  return (
    <section className="inspector-panel">
      <nav className="inspector-tabs">
        <span className="inspector-section-title">Inspector</span>
        <button className={activeTab === "call" ? "active" : ""} onClick={() => setActiveTab("call")}>
          Call
        </button>
        <button className={activeTab === "log" ? "active" : ""} onClick={() => setActiveTab("log")}>
          Log
        </button>
        <button className={activeTab === "errors" ? "active" : ""} onClick={() => setActiveTab("errors")}>
          Errors
        </button>
        <button className={activeTab === "console" ? "active" : ""} onClick={() => setActiveTab("console")}>
          Console
        </button>
        <button className={activeTab === "network" ? "active" : ""} onClick={() => setActiveTab("network")}>
          Network
        </button>
        <label className="inspector-live-toggle">
          <input
            type="checkbox"
            checked={liveSyncEnabled}
            onChange={(event) => onToggleLiveSync(event.target.checked)}
          />
          <span>Live</span>
        </label>
      </nav>

      <div className="inspector-content">
        {activeTab === "call" && <EventDetail event={selectedEvent} />}

        {activeTab === "log" && (
          <TabSplit
            storageKey="split-inspector-log"
            master={
              <EventMasterList
                events={logWindow}
                selectedId={selectedLogEvent?.id ?? null}
                onSelect={setSelectedLogId}
              />
            }
            detail={<EventDetail event={selectedLogEvent} />}
          />
        )}

        {activeTab === "errors" && (
          <TabSplit
            storageKey="split-inspector-errors"
            master={
              <EventMasterList
                events={errorWindow}
                selectedId={selectedErrorEvent?.id ?? null}
                onSelect={setSelectedErrorId}
              />
            }
            detail={<EventDetail event={selectedErrorEvent} />}
          />
        )}

        {activeTab === "console" && (
          <TabSplit
            storageKey="split-inspector-console"
            master={
              <EventMasterList
                events={consoleWindow}
                selectedId={selectedConsoleEvent?.id ?? null}
                onSelect={setSelectedConsoleId}
              />
            }
            detail={<EventDetail event={selectedConsoleEvent} />}
          />
        )}

        {activeTab === "network" && (
          <NetworkInspector
            entries={networkEntries}
            selectedRequestId={selectedRequestId}
            onSelectRequest={setSelectedRequestId}
          />
        )}
      </div>
    </section>
  );
}
