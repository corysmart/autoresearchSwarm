import type {
  DiscoveryFeedItem,
  GraphResponse,
  LeaderboardEntry,
  StatsResponse,
  TrustRecord
} from "../../../packages/contracts/src/index.ts";

export interface PeerView {
  node_id: string;
  base_url: string;
  runtime_mode: "local-only" | "peered" | "private-peered" | "libp2p-experimental";
  can_train: boolean;
  supports_simulation: boolean;
  disabled: boolean;
}

export interface AuditEventView {
  id: number;
  timestamp: string;
  source: string;
  severity: "info" | "warn" | "error";
  event_type: string;
  message: string;
  detail_json: string | null;
}

export interface WorkerRunView {
  run_id: string;
  experiment_hash: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary: string;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }
  return (await response.json()) as T;
}

export function fetchStats(): Promise<StatsResponse> {
  return getJson("/api/swarm/stats");
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const payload = await getJson<{ items: LeaderboardEntry[] }>("/api/swarm/leaderboard");
  return payload.items;
}

export function fetchGraph(): Promise<GraphResponse> {
  return getJson("/api/swarm/graph");
}

export async function fetchDiscoveries(): Promise<DiscoveryFeedItem[]> {
  const payload = await getJson<{ items: DiscoveryFeedItem[] }>("/api/swarm/discoveries");
  return payload.items;
}

export async function fetchPeers(): Promise<PeerView[]> {
  const payload = await getJson<{ items: PeerView[] }>("/api/swarm/peers");
  return payload.items;
}

export async function fetchTrust(): Promise<{ items: TrustRecord[]; reports: unknown[] }> {
  return getJson("/api/swarm/trust");
}

export async function fetchObservability(): Promise<{
  events: AuditEventView[];
  runs: WorkerRunView[];
  health: { api: string; workerPollSeconds: number; runtimeMode: string; peerCount: number };
}> {
  const [events, runs, health] = await Promise.all([
    getJson<{ items: AuditEventView[] }>("/api/observability/events"),
    getJson<{ items: WorkerRunView[] }>("/api/observability/runs"),
    getJson<{ api: string; workerPollSeconds: number; runtimeMode: string; peerCount: number }>("/api/observability/health")
  ]);
  return { events: events.items, runs: runs.items, health };
}

export async function togglePeering(mode: "enable" | "disable" | "private" | "libp2p-experimental"): Promise<void> {
  const response = await fetch(`/api/local/peering/${mode}`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`Failed to change networking mode: ${mode}`);
  }
}

export async function submitReport(payload: {
  reported_node_id: string;
  trust_type: "security" | "reputation";
  rating: number;
  reason: string;
}): Promise<void> {
  const response = await fetch("/api/local/trust/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Failed to submit report");
  }
}
