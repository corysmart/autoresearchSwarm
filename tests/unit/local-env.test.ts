import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadLocalEnv } from "../../packages/api/src/local-env.ts";

test("loadLocalEnv applies .env.local.default before .env.local and respects shell env", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "autoresearch-env-"));
  const originalBackend = process.env.HARNESS_AGENT_BACKEND;
  const originalPort = process.env.HARNESS_ERNEST_AGENT_PORT;
  const originalRuntimeMode = process.env.HARNESS_RUNTIME_MODE;

  try {
    delete process.env.HARNESS_AGENT_BACKEND;
    delete process.env.HARNESS_ERNEST_AGENT_PORT;
    process.env.HARNESS_RUNTIME_MODE = "local-only";

    writeFileSync(
      join(rootDir, ".env.local.default"),
      "HARNESS_AGENT_BACKEND=ernest-agent\nHARNESS_ERNEST_AGENT_PORT=4310\nHARNESS_RUNTIME_MODE=private-peered\n",
      "utf8"
    );
    writeFileSync(join(rootDir, ".env.local"), "HARNESS_AGENT_BACKEND=codex\n", "utf8");

    loadLocalEnv(rootDir);

    assert.equal(process.env.HARNESS_AGENT_BACKEND, "codex");
    assert.equal(process.env.HARNESS_ERNEST_AGENT_PORT, "4310");
    assert.equal(process.env.HARNESS_RUNTIME_MODE, "local-only");
  } finally {
    if (originalBackend === undefined) {
      delete process.env.HARNESS_AGENT_BACKEND;
    } else {
      process.env.HARNESS_AGENT_BACKEND = originalBackend;
    }
    if (originalPort === undefined) {
      delete process.env.HARNESS_ERNEST_AGENT_PORT;
    } else {
      process.env.HARNESS_ERNEST_AGENT_PORT = originalPort;
    }
    if (originalRuntimeMode === undefined) {
      delete process.env.HARNESS_RUNTIME_MODE;
    } else {
      process.env.HARNESS_RUNTIME_MODE = originalRuntimeMode;
    }
    rmSync(rootDir, { recursive: true, force: true });
  }
});
