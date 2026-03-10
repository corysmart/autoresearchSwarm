import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";

import {
  fetchDiscoveries,
  fetchGraph,
  fetchLeaderboard,
  fetchObservability,
  fetchPeers,
  fetchStats,
  fetchTrust,
  submitReport,
  togglePeering
} from "./api";
import {
  DashboardView,
  type DashboardState,
  type NetworkActionMode,
  type ViewKey
} from "./dashboard-view";

function readInitialView(): ViewKey {
  if (typeof window === "undefined") {
    return "stats";
  }
  const rawView = new URLSearchParams(window.location.search).get("view");
  return rawView === "leaderboard" ||
    rawView === "graph" ||
    rawView === "discoveries" ||
    rawView === "trust" ||
    rawView === "observability"
    ? rawView
    : "stats";
}

function shouldEnableLiveEvents(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return new URLSearchParams(window.location.search).get("screenshot") !== "1";
}

function createInitialDashboardState(): DashboardState {
  return {
    stats: null,
    leaderboard: [],
    graph: { nodes: [], edges: [] },
    discoveries: [],
    peers: [],
    trust: [],
    reports: [],
    auditEvents: [],
    workerRuns: [],
    health: null
  };
}

export function App(): ReactElement {
  const [view, setView] = useState<ViewKey>(readInitialView);
  const [liveEventsEnabled] = useState<boolean>(shouldEnableLiveEvents);
  const [state, setState] = useState<DashboardState>(createInitialDashboardState);
  const [reportTarget, setReportTarget] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [reportRating, setReportRating] = useState("-1");
  const [reportType, setReportType] = useState<"security" | "reputation">("reputation");
  const [networkBusyMode, setNetworkBusyMode] = useState<NetworkActionMode | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const [stats, leaderboard, graph, discoveries, peers, trust, observability] = await Promise.all([
      fetchStats(),
      fetchLeaderboard(),
      fetchGraph(),
      fetchDiscoveries(),
      fetchPeers(),
      fetchTrust(),
      fetchObservability()
    ]);
    setState({
      stats,
      leaderboard,
      graph,
      discoveries,
      peers,
      trust: trust.items,
      reports: trust.reports,
      auditEvents: observability.events,
      workerRuns: observability.runs,
      health: observability.health
    });
  }

  useEffect(() => {
    void refresh();
    if (!liveEventsEnabled) {
      return;
    }
    const eventSource = new EventSource("/api/events");
    const handler = (): void => {
      void refresh();
    };
    for (const eventName of ["swarm-event", "experiment", "worker-run-start", "worker-run-finish", "trust-report", "runtime-mode"]) {
      eventSource.addEventListener(eventName, handler);
    }
    return () => {
      eventSource.close();
    };
  }, [liveEventsEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    window.history.replaceState({}, "", url);
  }, [view]);

  const disabledCount = useMemo(
    () => state.trust.filter((record) => record.disabled).length,
    [state.trust]
  );

  async function onReportSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await submitReport({
      reported_node_id: reportTarget,
      trust_type: reportType,
      rating: Number(reportRating),
      reason: reportReason
    });
    setReportReason("");
    await refresh();
  }

  async function onTogglePeering(mode: NetworkActionMode): Promise<void> {
    setNetworkBusyMode(mode);
    setNetworkError(null);
    try {
      await togglePeering(mode);
      await refresh();
    } catch (error) {
      setNetworkError(error instanceof Error ? error.message : String(error));
    } finally {
      setNetworkBusyMode(null);
    }
  }

  return (
    <DashboardView
      view={view}
      state={state}
      disabledCount={disabledCount}
      networkBusyMode={networkBusyMode}
      networkError={networkError}
      onSelectView={setView}
      onTogglePeering={(mode) => void onTogglePeering(mode)}
      reportTarget={reportTarget}
      reportReason={reportReason}
      reportRating={reportRating}
      reportType={reportType}
      onReportTargetChange={setReportTarget}
      onReportReasonChange={setReportReason}
      onReportRatingChange={setReportRating}
      onReportTypeChange={setReportType}
      onReportSubmit={(event) => void onReportSubmit(event)}
    />
  );
}
