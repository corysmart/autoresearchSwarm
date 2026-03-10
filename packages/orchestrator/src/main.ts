import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadHarnessConfig } from "../../api/src/config.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const config = loadHarnessConfig(rootDir);

function spawnChild(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): ChildProcess {
  return spawn(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      HARNESS_API_HOST: config.apiHost,
      HARNESS_API_PORT: String(config.apiPort),
      HARNESS_UI_PORT: String(config.uiPort),
      HARNESS_API_BASE_URL: `http://${config.apiHost}:${config.apiPort}`,
      HARNESS_PUBLIC_BASE_URL: config.publicBaseUrl,
      HARNESS_AGENT_BACKEND: config.agentBackend,
      HARNESS_PLATFORM_CORE: config.platformCore,
      HARNESS_ERNEST_AGENT_URL: config.ernestAgentUrl ?? "",
      ...extraEnv
    }
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until deadline.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main(): Promise<void> {
  const processes: ChildProcess[] = [];
  if (config.agentBackend === "ernest-agent" && config.ernestAgentAutoStart) {
    const ernestServerEntry = resolve(config.ernestAgentRoot, "dist/server/server.js");
    if (!existsSync(ernestServerEntry)) {
      throw new Error(
        `Ernest-Agent backend requested but ${ernestServerEntry} is missing. Build Ernest Agent first or set HARNESS_ERNEST_AGENT_AUTO_START=0.`
      );
    }
    const ernest = spawn(process.execPath, [ernestServerEntry], {
      cwd: config.ernestAgentRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(config.ernestAgentPort),
        OBS_UI_ENABLED: "false",
        HEARTBEAT_ENABLED: "false",
        FILE_WORKSPACE_ROOT: config.worktreeDir,
        OPENCLAW_WORKSPACE_ROOT: config.worktreeDir,
        CODEX_CWD: config.worktreeDir
      }
    });
    processes.push(ernest);
    await waitFor(`${config.ernestAgentUrl}/health`, 20_000);
  }

  const api = spawnChild(process.execPath, ["--import", "tsx", "packages/api/src/main.ts"]);
  processes.push(api);
  await waitFor(`http://${config.apiHost}:${config.apiPort}/health`, 20_000);

  const worker = spawnChild("python3", ["-m", "harness_worker.main"], {
    HARNESS_WORKER_POLL_SECONDS: String(config.workerPollSeconds)
  });
  processes.push(worker);

  const ui = spawnChild(process.execPath, [
    resolve(rootDir, "node_modules/vite/bin/vite.js"),
    "--config",
    "apps/ui/vite.config.ts",
    "--host",
    config.apiHost,
    "--port",
    String(config.uiPort)
  ]);
  processes.push(ui);

  console.log(`API: http://${config.apiHost}:${config.apiPort}`);
  console.log(`UI: http://${config.apiHost}:${config.uiPort}`);

  const shutdown = (): void => {
    for (const child of processes) {
      child.kill("SIGTERM");
    }
    setTimeout(() => {
      for (const child of processes) {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }
      process.exit(0);
    }, 2_000);
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, shutdown);
  }
}

void main();
