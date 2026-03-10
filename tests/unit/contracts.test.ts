import assert from "node:assert/strict";
import test from "node:test";

import { buildExperimentHash, stableStringify } from "../../packages/contracts/src/index.ts";

test("stableStringify orders object keys deterministically", () => {
  const result = stableStringify({ b: 2, a: 1, nested: { z: 9, y: 8 } });
  assert.equal(result, '{"a":1,"b":2,"nested":{"y":8,"z":9}}');
});

test("buildExperimentHash is stable for identical content", () => {
  const input = {
    parent_hash: null,
    diff: "",
    metrics: {
      val_bpb: 0.99,
      peak_vram_mb: 12,
      training_seconds: 300,
      total_seconds: 320,
      execution_mode: "simulated" as const
    },
    model_hash: "abc",
    mutation_summary: "baseline",
    timestamp: "2026-03-10T00:00:00Z",
    node_id: "node-1"
  };
  assert.equal(buildExperimentHash(input), buildExperimentHash(input));
});

test("buildExperimentHash changes when checkpoint lineage changes", () => {
  const baseInput = {
    parent_hash: null,
    diff: "",
    metrics: {
      val_bpb: 0.99,
      peak_vram_mb: 12,
      training_seconds: 300,
      total_seconds: 320,
      execution_mode: "simulated" as const
    },
    model_hash: "abc",
    mutation_summary: "baseline",
    timestamp: "2026-03-10T00:00:00Z",
    node_id: "node-1"
  };
  assert.notEqual(
    buildExperimentHash({ ...baseInput, checkpoint_hash: "a".repeat(64) }),
    buildExperimentHash({ ...baseInput, checkpoint_hash: "b".repeat(64) })
  );
});
