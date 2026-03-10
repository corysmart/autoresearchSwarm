import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { App } from "../../apps/ui/src/App";
import {
  buildNetworkActions,
  ClusterSnapshot,
  DashboardView,
  formatExperimentHash,
  GraphView,
  NetworkControls
} from "../../apps/ui/src/dashboard-view";

test("GraphView renders an svg graph surface", () => {
  const html = renderToStaticMarkup(
    <GraphView
      graph={{
        nodes: [
          { id: "a", label: "baseline", score: 0.99, node_id: "node-a", origin: "local_verified", execution_mode: "simulated" }
        ],
        edges: []
      }}
    />
  );
  assert.match(html, /<svg/);
  assert.match(html, /baseline|0.990/);
});

test("formatExperimentHash shortens long hashes for compact display", () => {
  const hash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  assert.equal(formatExperimentHash(hash), "1234567890ab...90abcdef");
});

test("local-only network controls do not render disable action", () => {
  const html = renderToStaticMarkup(
    <NetworkControls
      nodeId="node-a"
      runtimeMode="local-only"
      busyMode={null}
      errorMessage={null}
      onToggle={() => undefined}
    />
  );
  assert.doesNotMatch(html, /Disable Networking/);
  assert.match(html, /Enable Private/);
});

test("buildNetworkActions shows state-aware actions", () => {
  assert.equal(buildNetworkActions("private-peered").some((action) => action.mode === "disable"), true);
  assert.equal(buildNetworkActions("local-only").some((action) => action.mode === "disable"), false);
  assert.equal(buildNetworkActions("peered").some((action) => action.label === "Switch to Private"), true);
  assert.equal(buildNetworkActions("libp2p-experimental").some((action) => action.mode === "enable"), false);
});

test("ClusterSnapshot shortens best model hash and preserves full title", () => {
  const longHash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const html = renderToStaticMarkup(
    <ClusterSnapshot
      stats={{
        nodeId: "node-a",
        runtimeMode: "private-peered",
        peersOnline: 2,
        experimentsTotal: 4,
        experimentsPerHour: 1,
        bestModel: {
          experiment_hash: longHash,
          parent_hash: null,
          node_id: "node-a",
          score: 0.91,
          timestamp: "2026-03-10T00:00:00Z",
          mutation_summary: "baseline",
          origin: "local_verified",
          execution_mode: "simulated",
          has_checkpoint: true
        }
      }}
    />
  );
  assert.match(html, /1234567890ab\.\.\.90abcdef/);
  assert.match(html, new RegExp(`title="${longHash}"`));
});

test("App renders the default dashboard shell", () => {
  const html = renderToStaticMarkup(<App />);
  assert.match(html, /Security-First Swarm/);
  assert.match(html, /Swarm Stats/);
  assert.match(html, /Cluster Snapshot/);
});

test("DashboardView renders non-stats panels when selected", () => {
  const html = renderToStaticMarkup(
    <DashboardView
      view="observability"
      state={{
        stats: {
          nodeId: "node-a",
          runtimeMode: "private-peered",
          peersOnline: 2,
          experimentsTotal: 4,
          experimentsPerHour: 1,
          bestModel: null
        },
        leaderboard: [],
        graph: { nodes: [], edges: [] },
        discoveries: [],
        peers: [],
        trust: [],
        reports: [],
        auditEvents: [{ id: 1, timestamp: "2026-03-10T00:00:00Z", source: "api", severity: "info", event_type: "startup", message: "ready", detail_json: null }],
        workerRuns: [{ run_id: "run-1", experiment_hash: null, status: "completed", started_at: "2026-03-10T00:00:00Z", finished_at: null, summary: "ok" }],
        health: {
          api: "healthy",
          workerPollSeconds: 1,
          runtimeMode: "private-peered",
          peerCount: 0,
          agentBackend: "auto",
          platformCore: "default"
        }
      }}
      disabledCount={0}
      networkBusyMode={null}
      networkError={null}
      onSelectView={() => undefined}
      onTogglePeering={() => undefined}
      reportTarget=""
      reportReason=""
      reportRating="-1"
      reportType="reputation"
      onReportTargetChange={() => undefined}
      onReportReasonChange={() => undefined}
      onReportRatingChange={() => undefined}
      onReportTypeChange={() => undefined}
      onReportSubmit={() => undefined}
    />
  );
  assert.match(html, /Recent Worker Runs/);
  assert.match(html, /Audit Events/);
});

test("NetworkControls surfaces busy and error states", () => {
  const html = renderToStaticMarkup(
    <NetworkControls
      nodeId="node-a"
      runtimeMode="private-peered"
      busyMode="enable"
      errorMessage="Failed to change networking mode: enable"
      onToggle={() => undefined}
    />
  );
  assert.match(html, /Working\.\.\./);
  assert.match(html, /Failed to change networking mode: enable/);
});

test("DashboardView renders leaderboard, discoveries, and trust branches", () => {
  const sharedState = {
    stats: {
      nodeId: "node-a",
      runtimeMode: "private-peered" as const,
      peersOnline: 2,
      experimentsTotal: 4,
      experimentsPerHour: 1,
      bestModel: null
    },
    leaderboard: [{
      experiment_hash: "abcdef1234567890",
      parent_hash: null,
      node_id: "node-a",
      score: 0.91,
      timestamp: "2026-03-10T00:00:00Z",
      mutation_summary: "baseline",
      origin: "local_verified" as const,
      execution_mode: "simulated" as const,
      has_checkpoint: true
    }],
    graph: { nodes: [], edges: [] },
    discoveries: [{ id: "d1", type: "experiment" as const, title: "Found", detail: "detail", node_id: "node-a", timestamp: "2026-03-10T00:00:00Z", origin: "local_verified" as const }],
    peers: [],
    trust: [{ node_id: "peer-a", source: "local" as const, security_violations: 1, reputation_reports: 1, reputation_score: -1, disabled: false, disable_reason: null, disable_reason_type: null, last_event_at: null }],
    reports: [],
    auditEvents: [],
    workerRuns: [],
    health: {
      api: "healthy",
      workerPollSeconds: 1,
      runtimeMode: "private-peered",
      peerCount: 0,
      agentBackend: "auto",
      platformCore: "default"
    }
  };

  const leaderboardHtml = renderToStaticMarkup(
    <DashboardView
      view="leaderboard"
      state={sharedState}
      disabledCount={0}
      networkBusyMode={null}
      networkError={null}
      onSelectView={() => undefined}
      onTogglePeering={() => undefined}
      reportTarget=""
      reportReason=""
      reportRating="-1"
      reportType="reputation"
      onReportTargetChange={() => undefined}
      onReportReasonChange={() => undefined}
      onReportRatingChange={() => undefined}
      onReportTypeChange={() => undefined}
      onReportSubmit={() => undefined}
    />
  );
  const discoveriesHtml = renderToStaticMarkup(
    <DashboardView
      view="discoveries"
      state={sharedState}
      disabledCount={0}
      networkBusyMode={null}
      networkError={null}
      onSelectView={() => undefined}
      onTogglePeering={() => undefined}
      reportTarget=""
      reportReason=""
      reportRating="-1"
      reportType="reputation"
      onReportTargetChange={() => undefined}
      onReportReasonChange={() => undefined}
      onReportRatingChange={() => undefined}
      onReportTypeChange={() => undefined}
      onReportSubmit={() => undefined}
    />
  );
  const trustHtml = renderToStaticMarkup(
    <DashboardView
      view="trust"
      state={sharedState}
      disabledCount={0}
      networkBusyMode={null}
      networkError={null}
      onSelectView={() => undefined}
      onTogglePeering={() => undefined}
      reportTarget="peer-a"
      reportReason="noise"
      reportRating="-1"
      reportType="reputation"
      onReportTargetChange={() => undefined}
      onReportReasonChange={() => undefined}
      onReportRatingChange={() => undefined}
      onReportTypeChange={() => undefined}
      onReportSubmit={() => undefined}
    />
  );

  assert.match(leaderboardHtml, /Top Experiments/);
  assert.match(leaderboardHtml, /yes/);
  assert.match(discoveriesHtml, /Discoveries Feed/);
  assert.match(discoveriesHtml, /Found/);
  assert.match(trustHtml, /Local Moderation/);
  assert.match(trustHtml, /peer-a/);
});
