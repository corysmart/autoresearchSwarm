from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from typing import Any

from .diffing import unified_text_diff


IMMUTABLE_CORE_FILES = [
    ".python-version",
    "README.md",
    "prepare.py",
    "program.md",
    "pyproject.toml",
    "train.py",
    "uv.lock",
]


@dataclass(frozen=True)
class PreparedWorkspace:
    run_id: str
    workspace_path: str
    train_contents: str
    diff: str
    mutation_summary: str
    model_hash: str
    produced_checkpoint_path: str


def detect_execution_mode(configured_mode: str) -> str:
    if configured_mode in {"real", "simulated"}:
        return configured_mode

    if shutil.which("uv") and shutil.which("nvidia-smi"):
        cache_dir = Path.home() / ".cache" / "autoresearch"
        if cache_dir.exists():
            return "real"
    return "simulated"


def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def _write_text(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)


def _replace_numeric_constant(contents: str, name: str, transform) -> str:
    pattern = re.compile(rf"^({name}\s*=\s*)(.+?)(\s*(?:#.*)?)$", re.MULTILINE)

    def repl(match: re.Match[str]) -> str:
        prefix, raw_value, suffix = match.groups()
        try:
            current = float(raw_value.strip())
        except ValueError:
            return match.group(0)
        next_value = transform(current)
        rendered = f"{next_value:.6f}".rstrip("0").rstrip(".")
        return f"{prefix}{rendered}{suffix}"

    return pattern.sub(repl, contents, count=1)


def next_mutation(parent_hash: str | None, iteration: int, original_contents: str) -> tuple[str, str]:
    if parent_hash is None:
        return original_contents, "baseline immutable core run"

    choice = iteration % 3
    if choice == 0:
        updated = _replace_numeric_constant(original_contents, "MATRIX_LR", lambda value: value * 0.95)
        return updated, "decrease MATRIX_LR by 5%"
    if choice == 1:
        updated = _replace_numeric_constant(original_contents, "WEIGHT_DECAY", lambda value: max(0.0, value * 0.9))
        return updated, "decrease WEIGHT_DECAY by 10%"

    updated = original_contents.replace('WINDOW_PATTERN = "SSSL"', 'WINDOW_PATTERN = "LLLL"', 1)
    return updated, "switch WINDOW_PATTERN to LLLL"


def checkpoint_file_path(directory: str, checkpoint_hash: str) -> str:
    return os.path.join(directory, f"{checkpoint_hash}.pt")


def _sha256_file(path: str) -> str:
    digest = sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare_workspace(
    root_dir: str,
    worktree_dir: str,
    run_id: str,
    parent_hash: str | None,
    iteration: int,
    base_train_source: str | None = None,
) -> PreparedWorkspace:
    workspace_path = os.path.join(worktree_dir, run_id)
    os.makedirs(workspace_path, exist_ok=True)

    for relative_path in IMMUTABLE_CORE_FILES:
        source = os.path.join(root_dir, relative_path)
        if os.path.exists(source):
            destination = os.path.join(workspace_path, relative_path)
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            shutil.copy2(source, destination)

    immutable_train = _read_text(os.path.join(root_dir, "train.py"))
    original_train = base_train_source if base_train_source else immutable_train
    updated_train, mutation_summary = next_mutation(parent_hash, iteration, original_train)
    _write_text(os.path.join(workspace_path, "train.py"), updated_train)
    diff = unified_text_diff(immutable_train, updated_train)
    model_hash = sha256(updated_train.encode("utf-8")).hexdigest()
    produced_checkpoint_path = os.path.join(workspace_path, "artifacts", "final-model.pt")

    metadata = {
        "run_id": run_id,
        "parent_hash": parent_hash,
        "mutation_summary": mutation_summary,
        "iteration": iteration,
        "model_hash": model_hash,
        "produced_checkpoint_path": produced_checkpoint_path,
    }
    _write_text(os.path.join(workspace_path, "harness-run.json"), json.dumps(metadata, indent=2))

    return PreparedWorkspace(
        run_id=run_id,
        workspace_path=workspace_path,
        train_contents=updated_train,
        diff=diff,
        mutation_summary=mutation_summary,
        model_hash=model_hash,
        produced_checkpoint_path=produced_checkpoint_path,
    )


def simulate_metrics(run_id: str, diff: str) -> dict[str, Any]:
    digest = sha256(f"{run_id}:{diff}".encode("utf-8")).digest()
    val_bpb = 0.97 + (digest[0] / 2550.0)
    return {
        "val_bpb": round(val_bpb, 6),
        "peak_vram_mb": 0.0,
        "training_seconds": 2.0,
        "total_seconds": 2.0,
        "execution_mode": "simulated",
        "notes": "Synthetic metrics because the local environment is not ready for GPU training."
    }


def parse_train_output(log_text: str) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "val_bpb": None,
        "peak_vram_mb": None,
        "training_seconds": None,
        "total_seconds": None,
        "execution_mode": "real",
    }
    patterns = {
        "val_bpb": re.compile(r"^val_bpb:\s+([0-9.]+)", re.MULTILINE),
        "peak_vram_mb": re.compile(r"^peak_vram_mb:\s+([0-9.]+)", re.MULTILINE),
        "training_seconds": re.compile(r"^training_seconds:\s+([0-9.]+)", re.MULTILINE),
        "total_seconds": re.compile(r"^total_seconds:\s+([0-9.]+)", re.MULTILINE),
    }
    for key, pattern in patterns.items():
        match = pattern.search(log_text)
        if match:
            metrics[key] = float(match.group(1))
    return metrics


def _write_simulated_checkpoint(workspace: PreparedWorkspace) -> None:
    checkpoint_path = Path(workspace.produced_checkpoint_path)
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "run_id": workspace.run_id,
        "model_hash": workspace.model_hash,
        "mutation_summary": workspace.mutation_summary,
    }
    checkpoint_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def cache_checkpoint_artifact(source_path: str, checkpoints_dir: str) -> dict[str, Any] | None:
    if not source_path or not os.path.exists(source_path):
        return None

    os.makedirs(checkpoints_dir, exist_ok=True)
    checkpoint_hash = _sha256_file(source_path)
    destination = checkpoint_file_path(checkpoints_dir, checkpoint_hash)
    if os.path.abspath(source_path) != os.path.abspath(destination):
        shutil.copy2(source_path, destination)

    return {
        "checkpoint_hash": checkpoint_hash,
        "checkpoint_size_bytes": os.path.getsize(destination),
    }


def run_experiment(
    workspace: PreparedWorkspace,
    mode: str,
    inherited_checkpoint_path: str | None = None,
) -> tuple[str, dict[str, Any], str]:
    if mode != "real":
        _write_simulated_checkpoint(workspace)
        return "completed", simulate_metrics(workspace.run_id, workspace.diff), ""

    command = ["uv", "run", "train.py"]
    started = time.time()
    completed = subprocess.run(
        command,
        cwd=workspace.workspace_path,
        env={
            **os.environ,
            "AUTORESEARCH_SAVE_CHECKPOINT": workspace.produced_checkpoint_path,
            **(
                {"AUTORESEARCH_LOAD_CHECKPOINT": inherited_checkpoint_path}
                if inherited_checkpoint_path
                else {}
            ),
        },
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    elapsed = time.time() - started
    output = f"{completed.stdout}\n{completed.stderr}".strip()
    if completed.returncode != 0:
        return (
            "failed",
            {
                "val_bpb": None,
                "peak_vram_mb": None,
                "training_seconds": elapsed,
                "total_seconds": elapsed,
                "execution_mode": "real",
                "notes": output[-2000:],
            },
            output,
        )
    metrics = parse_train_output(output)
    metrics["training_seconds"] = metrics.get("training_seconds") or elapsed
    metrics["total_seconds"] = metrics.get("total_seconds") or elapsed
    return "completed", metrics, output
