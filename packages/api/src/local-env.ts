import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let loadedRoot: string | null = null;

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadLocalEnv(rootDir: string = process.cwd()): void {
  if (loadedRoot === rootDir) {
    return;
  }

  const initialEnv = new Set(Object.keys(process.env));
  for (const fileName of [".env.local.default", ".env.local"]) {
    const envPath = join(rootDir, fileName);
    if (!existsSync(envPath)) {
      continue;
    }

    const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
      const separator = normalized.indexOf("=");
      if (separator <= 0) {
        continue;
      }

      const key = normalized.slice(0, separator).trim();
      if (!key || initialEnv.has(key)) {
        continue;
      }

      const value = stripQuotes(normalized.slice(separator + 1).trim());
      process.env[key] = value;
    }
  }

  loadedRoot = rootDir;
}
