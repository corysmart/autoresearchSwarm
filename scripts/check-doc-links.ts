import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

function markdownFiles(root: string): string[] {
  const files = ["README.md", "QUICKSTART.md"];
  const docsDir = resolve(root, "docs");
  const docEntries = existsSync(docsDir) ? readdirSync(docsDir).filter((file) => file.endsWith(".md")) : [];
  return [...files.map((file) => resolve(root, file)), ...docEntries.map((file) => resolve(docsDir, file))].filter(existsSync);
}

const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;
let failures = 0;

for (const file of markdownFiles(process.cwd())) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(markdownLink)) {
    const target = match[1];
    if (target.startsWith("http") || target.startsWith("#")) {
      continue;
    }
    const resolved = resolve(file, "..", target);
    if (!existsSync(resolved)) {
      console.error(`Broken link in ${file}: ${target}`);
      failures += 1;
    }
  }
}

if (failures > 0) {
  process.exit(1);
}

console.log("Documentation link check passed.");
