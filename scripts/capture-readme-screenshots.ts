import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

interface StatsResponse {
  experimentsTotal: number;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitFor(url: string, predicate: (payload: unknown) => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        const payload = contentType.includes("application/json") ? await response.json() : await response.text();
        if (predicate(payload)) {
          return;
        }
      }
    } catch {
      // Retry until timeout.
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function resolveBrowserBinary(): Promise<string> {
  const candidates = [
    process.env.HARNESS_SCREENSHOT_BROWSER,
    process.env.GOOGLE_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(
    "No compatible Chrome/Chromium binary found. Set HARNESS_SCREENSHOT_BROWSER to a headless-capable Chrome path."
  );
}

async function captureScreenshot(
  browserBinary: string,
  profileDir: string,
  url: string,
  outputPath: string
): Promise<void> {
  let timedOut = false;
  const result = spawnSync(
    browserBinary,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-breakpad",
      "--disable-sync",
      "--hide-scrollbars",
      "--no-default-browser-check",
      "--no-first-run",
      `--user-data-dir=${profileDir}`,
      "--window-size=1600,1200",
      "--force-device-scale-factor=1",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=10000",
      `--screenshot=${outputPath}`,
      url
    ],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
      timeout: 20_000,
      killSignal: "SIGKILL"
    }
  );

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      timedOut = true;
    } else {
      throw result.error;
    }
  }

  if (!timedOut && result.status !== 0) {
    throw new Error(`Screenshot capture failed for ${url}`);
  }

  const file = await stat(outputPath);
  if (file.size === 0) {
    throw new Error(`Screenshot file was empty: ${outputPath}`);
  }
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const outputDir = resolve(rootDir, "docs/screenshots");
  const tempRoot = await mkdtemp(join(tmpdir(), "autoresearch-readme-"));
  const apiPort = parseNumber(process.env.HARNESS_SCREENSHOT_API_PORT, 43172);
  const uiPort = parseNumber(process.env.HARNESS_SCREENSHOT_UI_PORT, 43173);

  await mkdir(outputDir, { recursive: true });

  const child = spawn(process.execPath, ["--import", "tsx", "packages/orchestrator/src/main.ts"], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      HARNESS_API_HOST: "127.0.0.1",
      HARNESS_API_PORT: String(apiPort),
      HARNESS_UI_PORT: String(uiPort),
      HARNESS_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      HARNESS_PUBLIC_BASE_URL: `http://127.0.0.1:${apiPort}`,
      HARNESS_DATA_DIR: join(tempRoot, "data"),
      HARNESS_WORKTREE_DIR: join(tempRoot, "worktrees"),
      HARNESS_WORKER_POLL_SECONDS: "1",
      HARNESS_EXECUTION_MODE: "simulated",
      HARNESS_AGENT_BACKEND: "heuristic",
      HARNESS_ERNEST_AGENT_AUTO_START: "0",
      HARNESS_ERNEST_AGENT_AUTO_BUILD: "0",
      HARNESS_RUNTIME_MODE: "private-peered",
      SWARM_PRIVATE_NETWORK_TOKEN: process.env.SWARM_PRIVATE_NETWORK_TOKEN ?? "readme-private-swarm"
    }
  });

  try {
    await waitFor(`http://127.0.0.1:${apiPort}/health`, () => true, 20_000);
    await waitFor(`http://127.0.0.1:${uiPort}`, () => true, 20_000);
    await waitFor(
      `http://127.0.0.1:${apiPort}/api/swarm/stats`,
      (payload) => typeof payload === "object" && payload !== null && (payload as StatsResponse).experimentsTotal >= 2,
      30_000
    );
    await waitFor(
      `http://127.0.0.1:${apiPort}/api/observability/runs`,
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        Array.isArray((payload as { items?: unknown[] }).items) &&
        ((payload as { items: unknown[] }).items.length > 0),
      30_000
    );

    const browserBinary = await resolveBrowserBinary();
    const baseUrl = `http://127.0.0.1:${uiPort}`;
    const screenshotUrl = (view: string) => `${baseUrl}/?view=${view}&screenshot=1`;
    const statsProfileDir = join(tempRoot, "chrome-profile-stats");
    const leaderboardProfileDir = join(tempRoot, "chrome-profile-leaderboard");
    const observabilityProfileDir = join(tempRoot, "chrome-profile-observability");
    await mkdir(statsProfileDir, { recursive: true });
    await mkdir(leaderboardProfileDir, { recursive: true });
    await mkdir(observabilityProfileDir, { recursive: true });
    await captureScreenshot(browserBinary, statsProfileDir, screenshotUrl("stats"), join(outputDir, "swarm-stats.png"));
    await captureScreenshot(
      browserBinary,
      leaderboardProfileDir,
      screenshotUrl("leaderboard"),
      join(outputDir, "swarm-leaderboard.png")
    );
    await captureScreenshot(
      browserBinary,
      observabilityProfileDir,
      screenshotUrl("observability"),
      join(outputDir, "swarm-observability.png")
    );
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}

void main();
