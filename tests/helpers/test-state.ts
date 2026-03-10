import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HarnessDatabase } from "../../packages/api/src/database.ts";
import { EventStreamBroker } from "../../packages/api/src/event-stream.ts";
import { loadNodeIdentity } from "../../packages/api/src/identity.ts";
import { SwarmService } from "../../packages/swarm/src/swarm-service.ts";
import type { HarnessConfig } from "../../packages/api/src/config.ts";
import type { ApiState } from "../../packages/api/src/state.ts";

export interface TestHarness {
  state: ApiState;
  cleanup(): void;
}

export function createTestHarness(overrides: Partial<HarnessConfig> = {}): TestHarness {
  const rootDir = mkdtempSync(join(tmpdir(), "autoresearch-harness-"));
  const config: HarnessConfig = {
    rootDir,
    dataDir: join(rootDir, "data"),
    worktreeDir: join(rootDir, "worktrees"),
    apiHost: "127.0.0.1",
    apiPort: 0,
    uiPort: 0,
    publicBaseUrl: "http://127.0.0.1:0",
    runtimeMode: "private-peered",
    bootstrapPeers: [],
    privateNetworkToken: null,
    allowExperimentalLibp2p: false,
    libp2pBootstrapMultiaddrs: [],
    libp2pListenMultiaddrs: ["/ip4/127.0.0.1/tcp/0"],
    maxInboundBytes: 64_000,
    peerRateLimitPerMinute: 100,
    securityDisableThreshold: 3,
    reputationDisableThreshold: -5,
    reputationReportDisableCount: 3,
    workerPollSeconds: 1,
    ...overrides
  };

  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.worktreeDir, { recursive: true });

  const db = new HarnessDatabase(config);
  const events = new EventStreamBroker();
  const identity = loadNodeIdentity(config.dataDir);
  const swarm = new SwarmService(db, config, identity, events);

  return {
    state: { config, db, events, identity, swarm },
    cleanup(): void {
      swarm.stop();
      rmSync(rootDir, { recursive: true, force: true });
    }
  };
}
