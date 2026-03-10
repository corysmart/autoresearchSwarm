import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

type Suite = "all" | "unit" | "integration" | "security" | "e2e" | "python";

function collectFiles(root: string, predicate: (path: string) => boolean): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const nextPath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(nextPath, predicate));
    } else if (predicate(nextPath)) {
      results.push(nextPath);
    }
  }
  return results.sort();
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const suite = (process.argv[2] ?? "all") as Suite;
if (suite === "all") {
  for (const nextSuite of ["unit", "integration", "security"] as const) {
    const tsTestFiles = collectFiles(join(process.cwd(), "tests", nextSuite), (path) =>
      path.endsWith(".test.ts") || path.endsWith(".test.tsx")
    );
    if (tsTestFiles.length > 0) {
      run("node", ["--import", "tsx", "--test", ...tsTestFiles]);
    }
  }
} else if (suite !== "python") {
  const tsTestFiles = collectFiles(join(process.cwd(), "tests", suite), (path) =>
    path.endsWith(".test.ts") || path.endsWith(".test.tsx")
  );
  if (tsTestFiles.length > 0) {
    run("node", ["--import", "tsx", "--test", ...tsTestFiles]);
  }
}

if (suite === "all" || suite === "unit" || suite === "python") {
  run("python3", ["-m", "unittest", "discover", "-s", "tests/python/unit", "-p", "test_*.py"]);
}
