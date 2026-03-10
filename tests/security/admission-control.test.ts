import assert from "node:assert/strict";
import test from "node:test";

import { SWARM_TOPICS } from "../../packages/contracts/src/index.ts";
import { createTestHarness } from "../helpers/test-state.ts";

test("repeated invalid events trigger local security disable", () => {
  const harness = createTestHarness({ securityDisableThreshold: 2 });
  const { state } = harness;
  const envelope = state.swarm.createEnvelope(SWARM_TOPICS.discovery, {
    node_id: state.identity.nodeId,
    base_url: state.config.publicBaseUrl,
    runtime_mode: "local-only",
    can_train: false,
    supports_simulation: true
  });
  envelope.signature = "bad";

  state.swarm.ingestEnvelope(envelope, "peer-a");
  state.swarm.ingestEnvelope({ ...envelope, event_id: `${envelope.event_id}-2` }, "peer-a");

  const trust = state.db.getTrustRecord(state.identity.nodeId);
  assert.equal(trust.disabled, true);
  assert.equal(trust.disable_reason_type, "security");
  harness.cleanup();
});

test("private peering rejects sync without the shared token", () => {
  const harness = createTestHarness({
    runtimeMode: "private-peered",
    privateNetworkToken: "secret-token"
  });
  const { state } = harness;
  const envelope = state.swarm.createEnvelope(SWARM_TOPICS.discovery, {
    node_id: state.identity.nodeId,
    base_url: state.config.publicBaseUrl,
    runtime_mode: "private-peered",
    can_train: false,
    supports_simulation: true
  });

  const result = state.swarm.handleSyncRequest("http://peer", [envelope], null);
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 1);
  harness.cleanup();
});
