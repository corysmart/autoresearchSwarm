import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { SWARM_TOPICS, buildExperimentHash, type ExperimentRecord } from "../../packages/contracts/src/index.ts";
import { createTestHarness } from "../helpers/test-state.ts";

function buildRemoteExperiment(nodeId: string): ExperimentRecord {
  const trainSource = 'WINDOW_PATTERN = "LLLL"\n';
  const modelHash = createHash("sha256").update(trainSource).digest("hex");
  const checkpointHash = "a".repeat(64);
  return {
    experiment_hash: buildExperimentHash({
      parent_hash: null,
      diff: "",
      metrics: {
        val_bpb: 0.4,
        peak_vram_mb: 0,
        training_seconds: 2,
        total_seconds: 2,
        execution_mode: "simulated"
      },
      model_hash: modelHash,
      checkpoint_hash: checkpointHash,
      mutation_summary: "remote-best",
      timestamp: "2026-03-10T00:00:00Z",
      node_id: nodeId
    }),
    parent_hash: null,
    metrics: {
      val_bpb: 0.4,
      peak_vram_mb: 0,
      training_seconds: 2,
      total_seconds: 2,
      execution_mode: "simulated"
    },
    model_hash: modelHash,
    train_source: trainSource,
    timestamp: "2026-03-10T00:00:00Z",
    node_id: nodeId,
    signature: "sig",
    status: "completed",
    mutation_summary: "remote-best",
    diff: "",
    checkpoint: {
      checkpoint_hash: checkpointHash,
      checkpoint_size_bytes: 256,
      checkpoint_url: `http://remote/api/artifacts/checkpoints/${checkpointHash}`,
      produced_by_node_id: nodeId
    },
    origin: "remote_authenticated"
  };
}

test("invalid swarm envelopes are rejected and counted as security violations", () => {
  const harness = createTestHarness();
  const { state } = harness;
  const envelope = state.swarm.createEnvelope(SWARM_TOPICS.discovery, {
    node_id: state.identity.nodeId,
    base_url: state.config.publicBaseUrl,
    runtime_mode: "local-only",
    can_train: false,
    supports_simulation: true
  });
  envelope.signature = "tampered";

  assert.equal(state.swarm.ingestEnvelope(envelope, "http://bad-peer"), false);
  assert.equal(state.db.getTrustRecord(state.identity.nodeId).security_violations, 1);
  harness.cleanup();
});

test("reputation disables remain local-only authority", () => {
  const harness = createTestHarness();
  const { state } = harness;
  const trust = state.db.addReputationReport({
    report_id: "report-1",
    reporter_node_id: "remote-node",
    reported_node_id: "peer-a",
    trust_type: "reputation",
    rating: -4,
    reason: "advisory",
    scope: "remote-advisory",
    timestamp: new Date().toISOString()
  });
  assert.equal(trust.reputation_reports, 0);
  assert.equal(trust.disabled, false);
  harness.cleanup();
});

test("experimental libp2p mode is blocked unless explicitly allowed", async () => {
  const harness = createTestHarness({ allowExperimentalLibp2p: false });
  const enabled = await harness.state.swarm.enableExperimentalLibp2p();
  assert.equal(enabled, false);
  assert.equal(harness.state.swarm.runtimeMode(), "private-peered");
  harness.cleanup();
});

test("public peering strips executable lineage from remote experiment records", () => {
  const harness = createTestHarness({ runtimeMode: "peered" });
  const { state } = harness;
  const payload = buildRemoteExperiment(state.identity.nodeId);
  const envelope = state.swarm.createEnvelope(SWARM_TOPICS.experiment, payload);

  assert.equal(state.swarm.ingestEnvelope(envelope, "http://peer"), true);
  const [leaderboardEntry] = state.db.listLeaderboard(1, true);
  assert.equal(leaderboardEntry?.has_checkpoint, false);
  assert.equal(state.db.schedulerParent("private-peered", "simulated"), null);
  harness.cleanup();
});

test("private peering preserves remote checkpoints for inheritance", () => {
  const harness = createTestHarness({ runtimeMode: "private-peered" });
  const { state } = harness;
  const payload = buildRemoteExperiment(state.identity.nodeId);
  const envelope = state.swarm.createEnvelope(SWARM_TOPICS.experiment, payload);

  assert.equal(state.swarm.ingestEnvelope(envelope, "http://peer"), true);
  const parent = state.db.schedulerParent("private-peered", "simulated");
  assert.equal(parent?.checkpoint?.checkpoint_hash, "a".repeat(64));
  assert.equal(parent?.train_source.includes('WINDOW_PATTERN = "LLLL"'), true);
  harness.cleanup();
});
