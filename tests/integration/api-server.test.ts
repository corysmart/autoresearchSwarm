import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { ingestLocalExperiment } from "../../packages/api/src/service.ts";
import { shouldAllowArtifactDownload } from "../../packages/api/src/server.ts";
import { createTestHarness } from "../helpers/test-state.ts";

test("local experiment submissions persist and drive local leaderboard", async () => {
  const harness = createTestHarness();
  const trainSource = "WINDOW_PATTERN = \"SSSL\"\n";
  const record = ingestLocalExperiment(harness.state, {
    parent_hash: null,
    metrics: {
      val_bpb: 0.98,
      peak_vram_mb: 0,
      training_seconds: 3,
      total_seconds: 3,
      execution_mode: "simulated"
    },
    model_hash: createHash("sha256").update(trainSource).digest("hex"),
    train_source: trainSource,
    timestamp: "2026-03-10T00:00:00Z",
    status: "completed",
    mutation_summary: "baseline",
    diff: "",
    checkpoint: {
      checkpoint_hash: "c".repeat(64),
      checkpoint_size_bytes: 128
    }
  });

  assert.equal(record.origin, "local_verified");
  assert.equal(record.checkpoint?.checkpoint_hash, "c".repeat(64));
  const leaderboard = harness.state.db.listLeaderboard();
  assert.equal(leaderboard.length, 1);
  assert.equal(leaderboard[0]?.has_checkpoint, true);
  harness.cleanup();
});

test("remote experiments are observable but excluded from automatic scheduling", () => {
  const harness = createTestHarness();
  const localHash = "local-hash";
  harness.state.db.saveExperiment({
    experiment_hash: localHash,
    parent_hash: null,
    metrics: {
      val_bpb: 0.91,
      peak_vram_mb: 0,
      training_seconds: 2,
      total_seconds: 2,
      execution_mode: "simulated"
    },
    model_hash: "local-model",
    train_source: "local train",
    timestamp: "2026-03-10T00:00:00Z",
    node_id: harness.state.identity.nodeId,
    signature: "sig",
    status: "completed",
    mutation_summary: "local",
    diff: "",
    checkpoint: null,
    origin: "local_verified"
  });
  harness.state.db.saveExperiment({
    experiment_hash: "remote-hash",
    parent_hash: null,
    metrics: {
      val_bpb: 0.5,
      peak_vram_mb: 0,
      training_seconds: 2,
      total_seconds: 2,
      execution_mode: "simulated"
    },
    model_hash: "remote-model",
    train_source: "remote train",
    timestamp: "2026-03-10T00:00:00Z",
    node_id: "remote-node",
    signature: "sig",
    status: "completed",
    mutation_summary: "remote",
    diff: "",
    checkpoint: {
      checkpoint_hash: "d".repeat(64),
      checkpoint_size_bytes: 256,
      checkpoint_url: "http://remote/api/artifacts/checkpoints/" + "d".repeat(64),
      produced_by_node_id: "remote-node"
    },
    origin: "remote_authenticated"
  });

  const parent = harness.state.db.schedulerParent("peered", "simulated");
  assert.equal(parent?.experiment_hash, localHash);
  harness.cleanup();
});

test("private scheduler can inherit from remote authenticated checkpoints", () => {
  const harness = createTestHarness();
  harness.state.db.saveExperiment({
    experiment_hash: "remote-best",
    parent_hash: null,
    metrics: {
      val_bpb: 0.41,
      peak_vram_mb: 0,
      training_seconds: 2,
      total_seconds: 2,
      execution_mode: "simulated"
    },
    model_hash: "remote-model",
    train_source: "WINDOW_PATTERN = \"LLLL\"\n",
    timestamp: "2026-03-10T00:00:00Z",
    node_id: "remote-node",
    signature: "sig",
    status: "completed",
    mutation_summary: "remote-best",
    diff: "",
    checkpoint: {
      checkpoint_hash: "e".repeat(64),
      checkpoint_size_bytes: 512,
      checkpoint_url: "http://remote/api/artifacts/checkpoints/" + "e".repeat(64),
      produced_by_node_id: "remote-node"
    },
    origin: "remote_authenticated"
  });

  const parent = harness.state.db.schedulerParent("private-peered", "simulated");
  assert.equal(parent?.experiment_hash, "remote-best");
  assert.equal(parent?.checkpoint?.checkpoint_hash, "e".repeat(64));
  harness.cleanup();
});

test("checkpoint artifact policy is private-only unless networking is local", () => {
  const privateHarness = createTestHarness({ runtimeMode: "private-peered", privateNetworkToken: "secret-token" });
  const privateRequest = { headers: { "x-swarm-private-token": "secret-token" } } as IncomingMessage;
  assert.equal(shouldAllowArtifactDownload(privateHarness.state, privateRequest), true);
  privateHarness.cleanup();

  const publicHarness = createTestHarness({ runtimeMode: "peered" });
  const publicRequest = { headers: {} } as IncomingMessage;
  assert.equal(shouldAllowArtifactDownload(publicHarness.state, publicRequest), false);
  publicHarness.cleanup();
});
