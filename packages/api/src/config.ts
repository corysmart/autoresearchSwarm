import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { RuntimeMode } from "../../contracts/src/index.ts";
import { loadLocalEnv } from "./local-env.ts";

export interface HarnessConfig {
  rootDir: string;
  dataDir: string;
  worktreeDir: string;
  apiHost: string;
  apiPort: number;
  uiPort: number;
  publicBaseUrl: string;
  runtimeMode: RuntimeMode;
  bootstrapPeers: string[];
  privateNetworkToken: string | null;
  allowExperimentalLibp2p: boolean;
  libp2pBootstrapMultiaddrs: string[];
  libp2pListenMultiaddrs: string[];
  maxInboundBytes: number;
  peerRateLimitPerMinute: number;
  securityDisableThreshold: number;
  reputationDisableThreshold: number;
  reputationReportDisableCount: number;
  workerPollSeconds: number;
  agentBackend: "auto" | "heuristic" | "codex" | "ernest-agent";
  platformCore: "auto" | "default" | "macos";
  ernestAgentUrl: string | null;
  ernestAgentRoot: string;
  ernestAgentAutoStart: boolean;
  ernestAgentPort: number;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadHarnessConfig(rootDir: string = process.cwd()): HarnessConfig {
  loadLocalEnv(rootDir);
  const dataDir = resolve(rootDir, process.env.HARNESS_DATA_DIR ?? "harness-data");
  const worktreeDir = resolve(rootDir, process.env.HARNESS_WORKTREE_DIR ?? "worktrees");

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(worktreeDir, { recursive: true });

  const apiHost = process.env.HARNESS_API_HOST ?? "127.0.0.1";
  const apiPort = parseNumber(process.env.HARNESS_API_PORT, 4172);
  const ernestAgentPort = parseNumber(process.env.HARNESS_ERNEST_AGENT_PORT, 4310);
  const agentBackend =
    process.env.HARNESS_AGENT_BACKEND === "heuristic"
      ? "heuristic"
      : process.env.HARNESS_AGENT_BACKEND === "codex"
        ? "codex"
        : process.env.HARNESS_AGENT_BACKEND === "ernest-agent"
          ? "ernest-agent"
          : "auto";
  const platformCore =
    process.env.HARNESS_PLATFORM_CORE === "default"
      ? "default"
      : process.env.HARNESS_PLATFORM_CORE === "macos"
        ? "macos"
        : "auto";

  return {
    rootDir,
    dataDir,
    worktreeDir,
    apiHost,
    apiPort,
    uiPort: parseNumber(process.env.HARNESS_UI_PORT, 4173),
    publicBaseUrl: process.env.HARNESS_PUBLIC_BASE_URL ?? `http://${apiHost}:${apiPort}`,
    runtimeMode:
      process.env.HARNESS_RUNTIME_MODE === "libp2p-experimental"
        ? "libp2p-experimental"
        : process.env.HARNESS_RUNTIME_MODE === "private-peered"
          ? "private-peered"
          : process.env.HARNESS_RUNTIME_MODE === "peered"
            ? "peered"
            : "private-peered",
    bootstrapPeers: (process.env.SWARM_BOOTSTRAP_PEERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    privateNetworkToken: process.env.SWARM_PRIVATE_NETWORK_TOKEN ?? null,
    allowExperimentalLibp2p: process.env.HARNESS_ALLOW_LIBP2P_EXPERIMENTAL === "1",
    libp2pBootstrapMultiaddrs: (process.env.SWARM_LIBP2P_BOOTSTRAP_MULTIADDRS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    libp2pListenMultiaddrs: (process.env.SWARM_LIBP2P_LISTEN_MULTIADDRS ?? "/ip4/0.0.0.0/tcp/0")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    maxInboundBytes: parseNumber(process.env.HARNESS_MAX_INBOUND_BYTES, 128_000),
    peerRateLimitPerMinute: parseNumber(process.env.HARNESS_PEER_RATE_LIMIT, 60),
    securityDisableThreshold: parseNumber(process.env.HARNESS_SECURITY_DISABLE_THRESHOLD, 5),
    reputationDisableThreshold: parseNumber(process.env.HARNESS_REPUTATION_DISABLE_THRESHOLD, -5),
    reputationReportDisableCount: parseNumber(process.env.HARNESS_REPUTATION_REPORT_DISABLE_COUNT, 5),
    workerPollSeconds: parseNumber(process.env.HARNESS_WORKER_POLL_SECONDS, 10),
    agentBackend,
    platformCore,
    ernestAgentUrl: process.env.HARNESS_ERNEST_AGENT_URL ?? `http://${apiHost}:${ernestAgentPort}`,
    ernestAgentRoot: resolve(rootDir, process.env.HARNESS_ERNEST_AGENT_ROOT ?? "../Ernest Agent"),
    ernestAgentAutoStart:
      process.env.HARNESS_ERNEST_AGENT_AUTO_START === "1" ||
      (process.env.HARNESS_ERNEST_AGENT_AUTO_START !== "0" && agentBackend === "ernest-agent"),
    ernestAgentPort,
  };
}
