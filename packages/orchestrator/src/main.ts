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

async function runCheckedAndWait(command: string, args: string[], cwd: string, label: string): Promise<void> {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env
  });
  const exitCode = await new Promise<number>((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}`);
  }
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
    const ernestUiEntry = resolve(config.ernestAgentRoot, "ui/dist/index.html");
    const ernestNodeModules = resolve(config.ernestAgentRoot, "node_modules");
    if (!existsSync(ernestNodeModules)) {
      throw new Error(
        `Ernest-Agent backend requested but ${ernestNodeModules} is missing. Run npm install in ${config.ernestAgentRoot} first.`
      );
    }
    if (config.ernestAgentAutoBuild || !existsSync(ernestServerEntry) || !existsSync(ernestUiEntry)) {
      await runCheckedAndWait("npm", ["run", "build"], config.ernestAgentRoot, "Ernest-Agent server build");
      if (config.ernestAgentUiEnabled) {
        await runCheckedAndWait("npm", ["run", "ui:build"], config.ernestAgentRoot, "Ernest-Agent UI build");
      }
    } else if (!existsSync(ernestServerEntry)) {
      throw new Error(
        `Ernest-Agent backend requested but ${ernestServerEntry} is missing. Build Ernest Agent first or set HARNESS_ERNEST_AGENT_AUTO_BUILD=1.`
      );
    }
    const ernest = spawn(process.execPath, [ernestServerEntry], {
      cwd: config.ernestAgentRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(config.ernestAgentPort),
        OBS_UI_ENABLED: config.ernestAgentUiEnabled ? "true" : "false",
        OBS_UI_SKIP_AUTH: "true",
        OBS_UI_BIND_LOCALHOST: "true",
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
