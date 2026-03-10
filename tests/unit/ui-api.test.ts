import assert from "node:assert/strict";
import test from "node:test";

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
} from "../../apps/ui/src/api.ts";

function installFetchStub(handler: typeof fetch): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("togglePeering throws when the API rejects the mode change", async () => {
  const restore = installFetchStub((async () => new Response(null, { status: 500 })) as typeof fetch);

  try {
    await assert.rejects(() => togglePeering("disable"), /Failed to change networking mode/);
  } finally {
    restore();
  }
});

test("UI API helpers map successful JSON responses", async () => {
  const restore = installFetchStub(
    (async (input) => {
      const path = typeof input === "string" ? input : input.toString();
      const payloads: Record<string, unknown> = {
        "/api/swarm/stats": {
          nodeId: "node-a",
          runtimeMode: "private-peered",
          peersOnline: 1,
          experimentsTotal: 2,
          experimentsPerHour: 3,
          bestModel: null
        },
        "/api/swarm/leaderboard": { items: [] },
        "/api/swarm/graph": { nodes: [], edges: [] },
        "/api/swarm/discoveries": { items: [] },
        "/api/swarm/peers": { items: [] },
        "/api/swarm/trust": { items: [], reports: [] },
        "/api/observability/events": { items: [] },
        "/api/observability/runs": { items: [] },
        "/api/observability/health": {
          api: "healthy",
          workerPollSeconds: 1,
          runtimeMode: "private-peered",
          peerCount: 0,
          agentBackend: "auto",
          platformCore: "default"
        },
        "/api/local/trust/report": { ok: true },
        "/api/local/peering/private": { ok: true }
      };
      const body = payloads[path];
      if (!body) {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch
  );

  try {
    const stats = await fetchStats();
    const leaderboard = await fetchLeaderboard();
    const graph = await fetchGraph();
    const discoveries = await fetchDiscoveries();
    const peers = await fetchPeers();
    const trust = await fetchTrust();
    const observability = await fetchObservability();
    await submitReport({
      reported_node_id: "peer-a",
      trust_type: "reputation",
      rating: -1,
      reason: "noise"
    });
    await togglePeering("private");

    assert.equal(stats.nodeId, "node-a");
    assert.deepEqual(leaderboard, []);
    assert.deepEqual(graph, { nodes: [], edges: [] });
    assert.deepEqual(discoveries, []);
    assert.deepEqual(peers, []);
    assert.deepEqual(trust, { items: [], reports: [] });
    assert.equal(observability.health.api, "healthy");
  } finally {
    restore();
  }
});
