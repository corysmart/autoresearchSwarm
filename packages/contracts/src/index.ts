import { createHash } from "node:crypto";

export const SWARM_TOPICS = {
  discovery: "swarm.discovery",
  experiment: "swarm.experiment",
  leaderboard: "swarm.leaderboard",
  reputation: "swarm.reputation"
} as const;

export type SwarmTopic = (typeof SWARM_TOPICS)[keyof typeof SWARM_TOPICS];

export type RuntimeMode = "local-only" | "peered" | "private-peered" | "libp2p-experimental";
export type ExecutionMode = "real" | "simulated" | "blocked";
export type ExperimentOrigin = "local_verified" | "remote_authenticated" | "quarantined";
export type ExperimentStatus = "pending" | "running" | "completed" | "failed" | "blocked";
export type TrustSource = "local" | "remote-advisory";
export type DisableReasonType = "security" | "reputation";

export interface CheckpointManifest {
  checkpoint_hash: string;
  checkpoint_size_bytes: number;
  checkpoint_url: string;
  produced_by_node_id: string;
}

export interface ExperimentMetrics {
  val_bpb: number | null;
  peak_vram_mb: number | null;
  training_seconds: number | null;
  total_seconds: number | null;
  execution_mode: ExecutionMode;
  notes?: string;
}

export interface ExperimentRecord {
  experiment_hash: string;
  parent_hash: string | null;
  metrics: ExperimentMetrics;
  model_hash: string;
  train_source: string;
  timestamp: string;
  node_id: string;
  signature: string;
  status: ExperimentStatus;
  mutation_summary: string;
  diff: string;
  checkpoint: CheckpointManifest | null;
  origin: ExperimentOrigin;
}

export interface DiscoveryEvent {
  node_id: string;
  base_url: string;
  runtime_mode: RuntimeMode;
  can_train: boolean;
  supports_simulation: boolean;
}

export interface LeaderboardEntry {
  experiment_hash: string;
  parent_hash: string | null;
  node_id: string;
  score: number | null;
  timestamp: string;
  mutation_summary: string;
  origin: ExperimentOrigin;
  execution_mode: ExecutionMode;
  has_checkpoint: boolean;
}

export interface LeaderboardEvent {
  top: LeaderboardEntry[];
}

export interface ReputationReport {
  report_id: string;
  reporter_node_id: string;
  reported_node_id: string;
  trust_type: DisableReasonType;
  rating: number;
  reason: string;
  scope: TrustSource;
  timestamp: string;
}

export interface SignedEnvelope<TPayload> {
  version: 1;
  event_id: string;
  topic: SwarmTopic;
  node_id: string;
  public_key: string;
  timestamp: string;
  nonce: string;
  payload_hash: string;
  payload: TPayload;
  signature: string;
}

export interface StatsResponse {
  nodeId: string;
  runtimeMode: RuntimeMode;
  peersOnline: number;
  experimentsTotal: number;
  experimentsPerHour: number;
  bestModel: LeaderboardEntry | null;
  localModeReason?: string;
}

export interface DiscoveryFeedItem {
  id: string;
  type: "experiment" | "discovery" | "trust";
  title: string;
  detail: string;
  node_id: string;
  timestamp: string;
  origin: ExperimentOrigin | TrustSource;
}

export interface TrustRecord {
  node_id: string;
  source: TrustSource;
  security_violations: number;
  reputation_reports: number;
  reputation_score: number;
  disabled: boolean;
  disable_reason: string | null;
  disable_reason_type: DisableReasonType | null;
  last_event_at: string | null;
}

export interface GraphNode {
  id: string;
  label: string;
  score: number | null;
  node_id: string;
  origin: ExperimentOrigin;
  execution_mode: ExecutionMode;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildPayloadHash<TPayload>(payload: TPayload): string {
  return sha256Hex(stableStringify(payload));
}

export function buildExperimentHash(input: {
  parent_hash: string | null;
  diff: string;
  metrics: ExperimentMetrics;
  model_hash: string;
  checkpoint_hash?: string | null;
  mutation_summary: string;
  timestamp: string;
  node_id: string;
}): string {
  return sha256Hex(stableStringify(input));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMetrics(value: unknown): value is ExperimentMetrics {
  if (!isObject(value)) {
    return false;
  }
  const executionMode = value.execution_mode;
  return (
    (value.val_bpb === null || typeof value.val_bpb === "number") &&
    (value.peak_vram_mb === null || typeof value.peak_vram_mb === "number") &&
    (value.training_seconds === null || typeof value.training_seconds === "number") &&
    (value.total_seconds === null || typeof value.total_seconds === "number") &&
    (executionMode === "real" || executionMode === "simulated" || executionMode === "blocked") &&
    (value.notes === undefined || typeof value.notes === "string")
  );
}

function isCheckpointManifest(value: unknown): value is CheckpointManifest {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.checkpoint_hash === "string" &&
    typeof value.checkpoint_size_bytes === "number" &&
    typeof value.checkpoint_url === "string" &&
    typeof value.produced_by_node_id === "string"
  );
}

export function isExperimentRecord(value: unknown): value is ExperimentRecord {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.experiment_hash === "string" &&
    (value.parent_hash === null || typeof value.parent_hash === "string") &&
    isMetrics(value.metrics) &&
    typeof value.model_hash === "string" &&
    typeof value.train_source === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.node_id === "string" &&
    typeof value.signature === "string" &&
    typeof value.status === "string" &&
    typeof value.mutation_summary === "string" &&
    typeof value.diff === "string" &&
    (value.checkpoint === null || isCheckpointManifest(value.checkpoint)) &&
    typeof value.origin === "string"
  );
}

export function isDiscoveryEvent(value: unknown): value is DiscoveryEvent {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.node_id === "string" &&
    typeof value.base_url === "string" &&
    (value.runtime_mode === "local-only" ||
      value.runtime_mode === "peered" ||
      value.runtime_mode === "private-peered" ||
      value.runtime_mode === "libp2p-experimental") &&
    typeof value.can_train === "boolean" &&
    typeof value.supports_simulation === "boolean"
  );
}

export function isLeaderboardEvent(value: unknown): value is LeaderboardEvent {
  if (!isObject(value) || !Array.isArray(value.top)) {
    return false;
  }
  return value.top.every((entry) => isObject(entry));
}

export function isReputationReport(value: unknown): value is ReputationReport {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.report_id === "string" &&
    typeof value.reporter_node_id === "string" &&
    typeof value.reported_node_id === "string" &&
    (value.trust_type === "security" || value.trust_type === "reputation") &&
    typeof value.rating === "number" &&
    typeof value.reason === "string" &&
    (value.scope === "local" || value.scope === "remote-advisory") &&
    typeof value.timestamp === "string"
  );
}

export function isSignedEnvelope<TPayload>(
  value: unknown,
  payloadGuard: (payload: unknown) => payload is TPayload
): value is SignedEnvelope<TPayload> {
  if (!isObject(value)) {
    return false;
  }
  return (
    value.version === 1 &&
    typeof value.event_id === "string" &&
    typeof value.topic === "string" &&
    typeof value.node_id === "string" &&
    typeof value.public_key === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.nonce === "string" &&
    typeof value.payload_hash === "string" &&
    typeof value.signature === "string" &&
    payloadGuard(value.payload)
  );
}
