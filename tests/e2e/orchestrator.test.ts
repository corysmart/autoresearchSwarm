import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("orchestrator starts private-peered harness with API and UI surfaces", async () => {
  const seed = Math.floor(Math.random() * 1000);
  const apiPort = 44000 + seed * 2;
  const uiPort = apiPort + 1;
  const child = spawn(process.execPath, ["--import", "tsx", "packages/orchestrator/src/main.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      HARNESS_API_PORT: String(apiPort),
      HARNESS_UI_PORT: String(uiPort),
      HARNESS_WORKER_POLL_SECONDS: "1",
      HARNESS_EXECUTION_MODE: "simulated"
    }
  });

  try {
    let ready = false;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const api = await fetch(`http://127.0.0.1:${apiPort}/health`);
        const ui = await fetch(`http://127.0.0.1:${uiPort}`);
        if (api.ok && ui.ok) {
          ready = true;
          break;
        }
      } catch {
        // Wait for services to start.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    assert.equal(ready, true);
    const stats = await fetch(`http://127.0.0.1:${apiPort}/api/swarm/stats`).then((value) => value.json());
    assert.equal(stats.runtimeMode, "private-peered");
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});
