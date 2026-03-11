import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadHarnessConfig } from "../../packages/api/src/config.ts";

test("loadHarnessConfig keeps Ernest disabled for committed auto defaults", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "autoresearch-config-"));
  const originalBackend = process.env.HARNESS_AGENT_BACKEND;
  const originalUrl = process.env.HARNESS_ERNEST_AGENT_URL;
  const originalUi = process.env.HARNESS_ERNEST_AGENT_UI_ENABLED;

  try {
    delete process.env.HARNESS_AGENT_BACKEND;
    delete process.env.HARNESS_ERNEST_AGENT_URL;
    delete process.env.HARNESS_ERNEST_AGENT_UI_ENABLED;

    writeFileSync(join(rootDir, ".env.local.default"), "HARNESS_AGENT_BACKEND=auto\n", "utf8");
    mkdirSync(join(rootDir, "harness-data"), { recursive: true });
    mkdirSync(join(rootDir, "worktrees"), { recursive: true });

    const config = loadHarnessConfig(rootDir);
    assert.equal(config.agentBackend, "auto");
    assert.equal(config.ernestAgentUrl, null);
    assert.equal(config.ernestAgentUiEnabled, false);
    assert.equal(config.ernestAgentAutoStart, false);
    assert.equal(config.ernestAgentAutoBuild, false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    if (originalBackend === undefined) {
      delete process.env.HARNESS_AGENT_BACKEND;
    } else {
      process.env.HARNESS_AGENT_BACKEND = originalBackend;
    }
    if (originalUrl === undefined) {
      delete process.env.HARNESS_ERNEST_AGENT_URL;
    } else {
      process.env.HARNESS_ERNEST_AGENT_URL = originalUrl;
    }
    if (originalUi === undefined) {
      delete process.env.HARNESS_ERNEST_AGENT_UI_ENABLED;
    } else {
      process.env.HARNESS_ERNEST_AGENT_UI_ENABLED = originalUi;
    }
  }
});
