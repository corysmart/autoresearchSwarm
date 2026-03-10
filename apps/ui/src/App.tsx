import { useEffect, useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from "react";

import type {
  DiscoveryFeedItem,
  GraphResponse,
  LeaderboardEntry,
  StatsResponse,
  TrustRecord
} from "../../../packages/contracts/src/index.ts";
import {
  fetchDiscoveries,
  fetchGraph,
  fetchLeaderboard,
  fetchObservability,
  fetchPeers,
  fetchStats,
  fetchTrust,
  submitReport,
  togglePeering,
  type AuditEventView,
  type PeerView,
  type WorkerRunView
} from "./api";

type ViewKey = "stats" | "leaderboard" | "graph" | "discoveries" | "trust" | "observability";

interface DashboardState {
  stats: StatsResponse | null;
  leaderboard: LeaderboardEntry[];
  graph: GraphResponse;
  discoveries: DiscoveryFeedItem[];
  peers: PeerView[];
  trust: TrustRecord[];
  reports: unknown[];
  auditEvents: AuditEventView[];
  workerRuns: WorkerRunView[];
  health: { api: string; workerPollSeconds: number; runtimeMode: string; peerCount: number } | null;
}

const navItems: Array<{ key: ViewKey; label: string }> = [
  { key: "stats", label: "Swarm Stats" },
  { key: "leaderboard", label: "Leaderboard" },
  { key: "graph", label: "Experiment Graph" },
  { key: "discoveries", label: "Discoveries Feed" },
  { key: "trust", label: "Trust / Moderation" },
  { key: "observability", label: "Observability" }
];

export function App(): ReactElement {
  const [view, setView] = useState<ViewKey>("stats");
  const [state, setState] = useState<DashboardState>({
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
  });
  const [reportTarget, setReportTarget] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [reportRating, setReportRating] = useState("-1");
  const [reportType, setReportType] = useState<"security" | "reputation">("reputation");

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
  }, []);

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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">Autoresearch</p>
          <h1>Security-First Swarm</h1>
          <p className="lede">Every node is a worker, peer, UI host, and local authority.</p>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={item.key === view ? "nav-item active" : "nav-item"}
              onClick={() => setView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="status-card">
          <p>Node</p>
          <strong>{state.stats?.nodeId ?? "loading"}</strong>
          <span>{state.stats?.runtimeMode ?? "private-peered"}</span>
          <div className="button-stack">
            <button onClick={() => void togglePeering("enable")}>Enable Public</button>
            <button onClick={() => void togglePeering("private")}>Enable Private</button>
            <button className="warning-button" onClick={() => void togglePeering("libp2p-experimental")}>
              Enable Experimental libp2p
            </button>
            <button onClick={() => void togglePeering("disable")}>Disable Networking</button>
          </div>
          <p className="warning-copy">Experimental libp2p mode is available for testing only and is not recommended yet.</p>
        </div>
      </aside>

      <main className="content">
        <header className="hero">
          <div>
            <p className="eyebrow">Operations Console</p>
            <h2>Swarm state, trust, and experiment flow in one local surface.</h2>
          </div>
          <div className="hero-metrics">
            <MetricCard label="Peers" value={String(state.stats?.peersOnline ?? 0)} />
            <MetricCard label="Experiments" value={String(state.stats?.experimentsTotal ?? 0)} />
            <MetricCard label="Disabled Nodes" value={String(disabledCount)} />
            <MetricCard label="Experiments / hr" value={String(state.stats?.experimentsPerHour ?? 0)} />
          </div>
        </header>

        {view === "stats" && (
          <section className="panel-grid">
            <Panel title="Cluster Snapshot">
              <dl className="key-grid">
                <div><dt>Runtime mode</dt><dd>{state.stats?.runtimeMode ?? "private-peered"}</dd></div>
                <div><dt>Best model</dt><dd>{state.stats?.bestModel?.experiment_hash ?? "none yet"}</dd></div>
                <div><dt>Best score</dt><dd>{state.stats?.bestModel?.score?.toFixed(6) ?? "n/a"}</dd></div>
                <div><dt>Reason</dt><dd>{state.stats?.localModeReason ?? "Network participation enabled"}</dd></div>
              </dl>
            </Panel>
            <Panel title="Peer Inventory">
              <table className="table">
                <thead><tr><th>Node</th><th>URL</th><th>Mode</th><th>Status</th></tr></thead>
                <tbody>
                  {state.peers.map((peer) => (
                    <tr key={peer.node_id}>
                      <td>{peer.node_id}</td>
                      <td>{peer.base_url}</td>
                      <td>{peer.runtime_mode}</td>
                      <td>{peer.disabled ? "disabled" : "active"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </section>
        )}

        {view === "leaderboard" && (
          <Panel title="Top Experiments">
            <table className="table">
              <thead><tr><th>Score</th><th>Experiment</th><th>Parent</th><th>Node</th><th>Mode</th><th>Checkpoint</th></tr></thead>
              <tbody>
                {state.leaderboard.map((entry) => (
                  <tr key={entry.experiment_hash}>
                    <td>{entry.score?.toFixed(6) ?? "n/a"}</td>
                    <td>{entry.experiment_hash.slice(0, 12)}</td>
                    <td>{entry.parent_hash?.slice(0, 12) ?? "root"}</td>
                    <td>{entry.node_id}</td>
                    <td>{entry.execution_mode}</td>
                    <td>{entry.has_checkpoint ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        {view === "graph" && (
          <Panel title="Experiment DAG">
            <GraphView graph={state.graph} />
          </Panel>
        )}

        {view === "discoveries" && (
          <Panel title="Discoveries Feed">
            <ul className="feed">
              {state.discoveries.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  <span>{item.node_id} · {new Date(item.timestamp).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {view === "trust" && (
          <section className="panel-grid">
            <Panel title="Trust State">
              <table className="table">
                <thead><tr><th>Node</th><th>Security</th><th>Reports</th><th>Score</th><th>Disabled</th><th>Reason</th></tr></thead>
                <tbody>
                  {state.trust.map((record) => (
                    <tr key={record.node_id}>
                      <td>{record.node_id}</td>
                      <td>{record.security_violations}</td>
                      <td>{record.reputation_reports}</td>
                      <td>{record.reputation_score}</td>
                      <td>{record.disabled ? "yes" : "no"}</td>
                      <td>{record.disable_reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Panel title="Local Moderation">
              <form className="report-form" onSubmit={(event) => void onReportSubmit(event)}>
                <label>
                  Node ID
                  <input value={reportTarget} onChange={(event) => setReportTarget(event.target.value)} required />
                </label>
                <label>
                  Reason
                  <textarea value={reportReason} onChange={(event) => setReportReason(event.target.value)} required />
                </label>
                <label>
                  Rating delta
                  <input value={reportRating} onChange={(event) => setReportRating(event.target.value)} required />
                </label>
                <label>
                  Type
                  <select value={reportType} onChange={(event) => setReportType(event.target.value as "security" | "reputation")}>
                    <option value="reputation">Reputation</option>
                    <option value="security">Security</option>
                  </select>
                </label>
                <button type="submit">Submit Local Report</button>
              </form>
              <p className="muted">Remote advisory reports are visible but not authoritative. Local policy is final.</p>
            </Panel>
          </section>
        )}

        {view === "observability" && (
          <section className="panel-grid">
            <Panel title="Service Health">
              <dl className="key-grid">
                <div><dt>API</dt><dd>{state.health?.api ?? "unknown"}</dd></div>
                <div><dt>Worker poll</dt><dd>{state.health?.workerPollSeconds ?? "?"}s</dd></div>
                <div><dt>Mode</dt><dd>{state.health?.runtimeMode ?? "private-peered"}</dd></div>
                <div><dt>Known peers</dt><dd>{state.health?.peerCount ?? 0}</dd></div>
              </dl>
            </Panel>
            <Panel title="Recent Worker Runs">
              <ul className="feed compact">
                {state.workerRuns.map((run) => (
                  <li key={run.run_id}>
                    <strong>{run.status}</strong>
                    <p>{run.summary}</p>
                    <span>{new Date(run.started_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Audit Events">
              <ul className="feed compact">
                {state.auditEvents.map((event) => (
                  <li key={event.id}>
                    <strong>{event.severity.toUpperCase()} · {event.event_type}</strong>
                    <p>{event.message}</p>
                    <span>{new Date(event.timestamp).toLocaleString()} · {event.source}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </section>
        )}
      </main>
    </div>
  );
}

export function MetricCard({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="panel">
      <div className="panel-header">
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function GraphView({ graph }: { graph: GraphResponse }): ReactElement {
  const nodes = graph.nodes.slice(0, 24);
  const edges = graph.edges.filter((edge) => nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target));
  const positions = new Map(nodes.map((node, index) => [node.id, { x: 70 + (index % 4) * 180, y: 80 + Math.floor(index / 4) * 110 }]));

  return (
    <svg className="graph" viewBox="0 0 760 520" role="img" aria-label="Experiment graph">
      {edges.map((edge) => {
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!source || !target) {
          return null;
        }
        return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} />;
      })}
      {nodes.map((node) => {
        const position = positions.get(node.id);
        if (!position) {
          return null;
        }
        return (
          <g key={node.id} transform={`translate(${position.x}, ${position.y})`}>
            <circle r="28" />
            <text y="-4">{node.score?.toFixed(3) ?? "n/a"}</text>
            <text y="16">{node.node_id.slice(0, 8)}</text>
          </g>
        );
      })}
    </svg>
  );
}
