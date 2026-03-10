import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { ApiState } from "./state.ts";
import { ingestLocalExperiment, submitLocalReport, type LocalExperimentInput } from "./service.ts";

function cors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  cors(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

async function readJson<T>(request: IncomingMessage, maxBytes: number): Promise<T> {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("payload_too_large");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error("payload_too_large");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function matchPath(url: URL, path: string): boolean {
  return url.pathname === path;
}

function getPrivateToken(request: IncomingMessage): string | null {
  return typeof request.headers["x-swarm-private-token"] === "string"
    ? request.headers["x-swarm-private-token"]
    : null;
}

export function shouldAllowArtifactDownload(state: ApiState, request: IncomingMessage): boolean {
  const mode = state.swarm.runtimeMode();
  if (mode === "peered") {
    return false;
  }
  if ((mode === "private-peered" || mode === "libp2p-experimental") && state.config.privateNetworkToken) {
    return getPrivateToken(request) === state.config.privateNetworkToken;
  }
  return true;
}

async function serveDashboardIndex(response: ServerResponse): Promise<void> {
  const filePath = resolve(process.cwd(), "apps/ui/public/index-fallback.html");
  const content = await readFile(filePath, "utf8");
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(content);
}

export function createApiServer(state: ApiState): Server {
  return createServer(async (request, response) => {
    cors(response);
    if (!request.url) {
      sendJson(response, 400, { error: "missing_url" });
      return;
    }

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${state.config.apiHost}:${state.config.apiPort}`);

    try {
      const checkpointMatch =
        request.method === "GET"
          ? /^\/api\/artifacts\/checkpoints\/([a-f0-9]{64})$/.exec(url.pathname)
          : null;

      if (request.method === "GET" && matchPath(url, "/health")) {
        sendJson(response, 200, {
          ok: true,
          nodeId: state.identity.nodeId,
          runtimeMode: state.swarm.runtimeMode()
        });
        return;
      }

      if (request.method === "GET" && matchPath(url, "/")) {
        await serveDashboardIndex(response);
        return;
      }

      if (request.method === "GET" && matchPath(url, "/api/events")) {
        state.events.addClient(response);
        return;
      }

      if (request.method === "GET" && matchPath(url, "/api/swarm/stats")) {
        sendJson(response, 200, state.db.buildStats(state.identity.nodeId, state.swarm.runtimeMode()));
        return;
      }

      if (request.method === "GET" && matchPath(url, "/api/swarm/leaderboard")) {
        sendJson(response, 200, { items: state.db.listLeaderboard(50) });
        return;
      }

      if (request.method === "GET" && matchPath(url, "/api/swarm/graph")) {
        sendJson(response, 200, state.db.listGraph());
        return;
      }

      if (request.method === "GET" && matchPath(url, "/api/swarm/discoveries")) {
        sendJson(response, 200, { items: state.db.listFeed(100) });
        return;
      }

      if (request.method === "GET" && matchPath(url, "/api/swarm/peers")) {
        sendJson(response, 200, { items: state.db.listPeers() });
        return;
      }

      if (request.method === "GET" && matchPath(url, "/api/swarm/trust")) {
        sendJson(response, 200, { items: state.db.listTrustRecords(), reports: state.db.listReports(100) });
        return;
      }

      if (request.method === "GET" && matchPath(url, "/api/observability/events")) {
        sendJson(response, 200, { items: state.db.listAuditEvents(200) });
        return;
      }

      if (request.method === "GET" && matchPath(url, "/api/observability/runs")) {
        sendJson(response, 200, { items: state.db.listWorkerRuns(50) });
        return;
      }

      if (request.method === "GET" && matchPath(url, "/api/observability/health")) {
        sendJson(response, 200, {
          api: "healthy",
          workerPollSeconds: state.config.workerPollSeconds,
          runtimeMode: state.swarm.runtimeMode(),
          peerCount: state.db.listPeers().length,
          agentBackend: state.config.agentBackend,
          platformCore: state.config.platformCore,
          ernestAgentUrl: state.config.ernestAgentUrl,
          ernestAgentUiEnabled: state.config.ernestAgentUiEnabled
        });
        return;
      }

      if (request.method === "GET" && matchPath(url, "/api/local/scheduler/next")) {
        const executionMode = url.searchParams.get("execution_mode");
        const platformCore = url.searchParams.get("platform_core");
        sendJson(response, 200, {
          parent:
            executionMode === "real" || executionMode === "simulated" || executionMode === "blocked"
              ? state.db.schedulerParent(
                  state.swarm.runtimeMode(),
                  executionMode,
                  platformCore === "macos" ? "macos" : "default"
                )
              : state.db.schedulerParent(state.swarm.runtimeMode(), "simulated", "default"),
          nodeId: state.identity.nodeId,
          worktreeDir: state.config.worktreeDir
        });
        return;
      }

      if (checkpointMatch) {
        if (!shouldAllowArtifactDownload(state, request)) {
          sendJson(response, 403, {
            error: "artifact_download_forbidden",
            message: "Checkpoint downloads are only available in local/private swarm modes."
          });
          return;
        }
        const filePath = join(state.config.dataDir, "checkpoints", `${checkpointMatch[1]}.pt`);
        try {
          await stat(filePath);
        } catch {
          sendJson(response, 404, { error: "checkpoint_not_found" });
          return;
        }
        const stream = createReadStream(filePath);
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/octet-stream");
        stream.on("error", () => {
          response.destroy();
        });
        stream.pipe(response);
        return;
      }

      if (request.method === "POST" && matchPath(url, "/api/local/peering/enable")) {
        state.swarm.enablePeering();
        state.events.broadcast({ event: "runtime-mode", data: { mode: "peered" } });
        sendJson(response, 200, { ok: true, mode: "peered" });
        return;
      }

      if (request.method === "POST" && matchPath(url, "/api/local/peering/private")) {
        state.swarm.enablePrivatePeering();
        state.events.broadcast({ event: "runtime-mode", data: { mode: "private-peered" } });
        sendJson(response, 200, { ok: true, mode: "private-peered" });
        return;
      }

      if (request.method === "POST" && matchPath(url, "/api/local/peering/libp2p-experimental")) {
        const enabled = await state.swarm.enableExperimentalLibp2p();
        if (!enabled) {
          sendJson(response, 409, {
            ok: false,
            mode: state.swarm.runtimeMode(),
            error: "libp2p_experimental_disabled",
            message: "Set HARNESS_ALLOW_LIBP2P_EXPERIMENTAL=1 to enable this unsupported transport."
          });
          return;
        }
        state.events.broadcast({ event: "runtime-mode", data: { mode: "libp2p-experimental" } });
        sendJson(response, 200, {
          ok: true,
          mode: "libp2p-experimental",
          warning: "Experimental libp2p mode is not recommended for normal use."
        });
        return;
      }

      if (request.method === "POST" && matchPath(url, "/api/local/peering/disable")) {
        state.swarm.disablePeering();
        state.events.broadcast({ event: "runtime-mode", data: { mode: "local-only" } });
        sendJson(response, 200, { ok: true, mode: "local-only" });
        return;
      }

      if (request.method === "POST" && matchPath(url, "/api/local/trust/report")) {
        const body = await readJson<{
          reported_node_id: string;
          trust_type: "security" | "reputation";
          rating: number;
          reason: string;
        }>(request, state.config.maxInboundBytes);
        const report = submitLocalReport(state, body);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && matchPath(url, "/api/internal/worker/run-start")) {
        const body = await readJson<{ run_id: string; summary: string }>(request, state.config.maxInboundBytes);
        state.db.startWorkerRun(body.run_id, body.summary);
        state.events.broadcast({ event: "worker-run-start", data: body });
        sendJson(response, 202, { ok: true });
        return;
      }

      if (request.method === "POST" && matchPath(url, "/api/internal/worker/run-finish")) {
        const body = await readJson<{
          run_id: string;
          status: string;
          summary: string;
          experiment_hash: string | null;
        }>(request, state.config.maxInboundBytes);
        state.db.finishWorkerRun(body.run_id, body.status, body.summary, body.experiment_hash);
        state.events.broadcast({ event: "worker-run-finish", data: body });
        sendJson(response, 202, { ok: true });
        return;
      }

      if (request.method === "POST" && matchPath(url, "/api/internal/local-experiments")) {
        const body = await readJson<LocalExperimentInput>(request, state.config.maxInboundBytes);
        const record = ingestLocalExperiment(state, body);
        sendJson(response, 201, record);
        return;
      }

      if (request.method === "POST" && matchPath(url, "/api/internal/swarm/sync")) {
        const body = await readJson<{ source: string; events: unknown[] }>(request, state.config.maxInboundBytes);
        const syncResponse = state.swarm.handleSyncRequest(
          body.source,
          (body.events ?? []) as Parameters<typeof state.swarm.handleSyncRequest>[1],
          getPrivateToken(request)
        );
        sendJson(response, 200, syncResponse);
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      state.db.appendAuditEvent("api", "error", "request_failure", String(error), {
        path: request.url,
        method: request.method
      });
      sendJson(response, 500, { error: String(error) });
    }
  });
}
