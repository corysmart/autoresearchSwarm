import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredFiles = [
  "README.md",
  "prepare.py",
  "train.py",
  "program.md",
  "pyproject.toml",
  "uv.lock"
];

for (const file of requiredFiles) {
  if (!existsSync(resolve(process.cwd(), file))) {
    throw new Error(`Missing immutable core file: ${file}`);
  }
}

const train = readFileSync(resolve(process.cwd(), "train.py"), "utf8");
const prepare = readFileSync(resolve(process.cwd(), "prepare.py"), "utf8");

for (const token of [
  "TOTAL_BATCH_SIZE",
  "MATRIX_LR",
  "WINDOW_PATTERN",
  "AUTORESEARCH_LOAD_CHECKPOINT",
  "AUTORESEARCH_SAVE_CHECKPOINT"
]) {
  if (!train.includes(token)) {
    throw new Error(`train.py contract missing token ${token}`);
  }
}

for (const token of ["MAX_SEQ_LEN", "TIME_BUDGET", "evaluate_bpb"]) {
  if (!prepare.includes(token)) {
    throw new Error(`prepare.py contract missing token ${token}`);
  }
}

console.log("Core contract check passed.");
