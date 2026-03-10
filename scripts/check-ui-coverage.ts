import { spawnSync } from "node:child_process";

const args = [
  "--experimental-test-coverage",
  "--test-coverage-lines=90",
  "--test-coverage-include=apps/ui/src/api.ts",
  "--test-coverage-include=apps/ui/src/dashboard-view.tsx",
  "--import",
  "tsx",
  "--test",
  "tests/unit/ui-components.test.tsx",
  "tests/unit/ui-api.test.ts"
];

const result = spawnSync(process.execPath, args, {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
