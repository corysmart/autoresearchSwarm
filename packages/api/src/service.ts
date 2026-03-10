import { randomUUID } from "node:crypto";

import { buildExperimentHash, type ExperimentMetrics, type ExperimentStatus, type ReputationReport } from "../../contracts/src/index.ts";
import type { ApiState } from "./state.ts";

export interface LocalExperimentInput {
  parent_hash: string | null;
  metrics: ExperimentMetrics;
  model_hash: string;
  train_source: string;
  timestamp: string;
  status: ExperimentStatus;
  mutation_summary: string;
  diff: string;
  checkpoint?: {
    checkpoint_hash: string;
    checkpoint_size_bytes: number;
  } | null;
}

export function ingestLocalExperiment(state: ApiState, body: LocalExperimentInput) {
  const timestamp = body.timestamp || new Date().toISOString();
  const checkpoint = body.checkpoint
    ? {
        checkpoint_hash: body.checkpoint.checkpoint_hash,
        checkpoint_size_bytes: body.checkpoint.checkpoint_size_bytes,
        checkpoint_url: `${state.config.publicBaseUrl}/api/artifacts/checkpoints/${body.checkpoint.checkpoint_hash}`,
        produced_by_node_id: state.identity.nodeId
      }
    : null;
  const experiment_hash = buildExperimentHash({
    parent_hash: body.parent_hash,
    diff: body.diff,
    metrics: body.metrics,
    model_hash: body.model_hash,
    checkpoint_hash: checkpoint?.checkpoint_hash ?? null,
    mutation_summary: body.mutation_summary,
    timestamp,
    node_id: state.identity.nodeId
  });
  const signature = state.identity.signPayload(experiment_hash);
  const record = {
    experiment_hash,
    parent_hash: body.parent_hash,
    metrics: body.metrics,
    model_hash: body.model_hash,
    train_source: body.train_source,
    timestamp,
    node_id: state.identity.nodeId,
    signature,
    status: body.status,
    mutation_summary: body.mutation_summary,
    diff: body.diff,
    checkpoint,
    origin: "local_verified" as const
  };
  state.db.saveExperiment(record);
  state.db.addFeedItem({
    id: experiment_hash,
    type: "experiment",
    title: `Local experiment ${body.status}`,
    detail: body.mutation_summary,
    node_id: state.identity.nodeId,
    timestamp,
    origin: "local_verified"
  });
  state.db.appendAuditEvent("worker", "info", "experiment_saved", body.mutation_summary, record);
  state.events.broadcast({ event: "experiment", data: record });
  void state.swarm.publishExperiment(record);
  return record;
}

export function submitLocalReport(
  state: ApiState,
  payload: {
    reported_node_id: string;
    trust_type: "security" | "reputation";
    rating: number;
    reason: string;
  }
): ReputationReport {
  const report: ReputationReport = {
    report_id: randomUUID(),
    reporter_node_id: state.identity.nodeId,
    reported_node_id: payload.reported_node_id,
    trust_type: payload.trust_type,
    rating: payload.rating,
    reason: payload.reason,
    scope: "local",
    timestamp: new Date().toISOString()
  };
  state.db.addReputationReport(report);
  const trust = state.db.getTrustRecord(report.reported_node_id);
  if (
    trust.reputation_reports >= state.config.reputationReportDisableCount ||
    trust.reputation_score <= state.config.reputationDisableThreshold
  ) {
    state.db.disableNode(report.reported_node_id, "Local reputation threshold exceeded", "reputation");
  }
  state.db.addFeedItem({
    id: report.report_id,
    type: "trust",
    title: `Local report for ${report.reported_node_id}`,
    detail: `${report.trust_type}: ${report.reason}`,
    node_id: report.reported_node_id,
    timestamp: report.timestamp,
    origin: "local"
  });
  if (state.swarm.runtimeMode() !== "local-only") {
    void state.swarm.publishReputation(report);
  }
  state.events.broadcast({ event: "trust-report", data: report });
  return report;
}
