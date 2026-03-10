from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import time
from typing import Any

from .agent_backends import next_mutation
from .diffing import unified_text_diff
from .platform_core import PLATFORM_CORE_OVERRIDE_FILES, build_platform_core_profile


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
    platform_core: str
    train_contents: str
    diff: str
    mutation_summary: str
    model_hash: str
    produced_checkpoint_path: str


@dataclass(frozen=True)
class WorkspaceDraft:
    run_id: str
    workspace_path: str
    platform_core: str
    immutable_train_contents: str
    base_train_contents: str
    produced_checkpoint_path: str


def detect_execution_mode(configured_mode: str, platform_core: str = "auto") -> str:
    if configured_mode in {"real", "simulated"}:
        return configured_mode

    profile = build_platform_core_profile(os.getcwd(), platform_core)
    if shutil.which("uv"):
        if profile.name == "macos":
            system = platform.system()
            machine = platform.machine().lower()
            if system == "Darwin" and machine in {"arm64", "aarch64"}:
                return "real"
        elif shutil.which("nvidia-smi"):
            return "real"
    return "simulated"


def autoresearch_cache_ready() -> bool:
    cache_dir = Path.home() / ".cache" / "autoresearch"
    tokenizer_dir = cache_dir / "tokenizer"
    data_dir = cache_dir / "data"
    tokenizer_pkl = tokenizer_dir / "tokenizer.pkl"
    token_bytes = tokenizer_dir / "token_bytes.pt"
    shard_count = sum(1 for path in data_dir.glob("*.parquet") if path.is_file()) if data_dir.exists() else 0
    return tokenizer_pkl.exists() and token_bytes.exists() and shard_count >= 2


def ensure_platform_runtime(root_dir: str, platform_core: str) -> None:
    if autoresearch_cache_ready():
        return

    profile = build_platform_core_profile(root_dir, platform_core)
    cwd = profile.overlay_dir or root_dir
    completed = subprocess.run(
        ["uv", "run", "prepare.py"],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=1_800,
        check=False,
    )
    if completed.returncode != 0:
        output = f"{completed.stdout}\n{completed.stderr}".strip()
        raise RuntimeError(f"prepare.py failed for platform core {profile.name}: {output[-4000:]}")


def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def _write_text(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)


def checkpoint_file_path(directory: str, checkpoint_hash: str) -> str:
    return os.path.join(directory, f"{checkpoint_hash}.pt")


def _sha256_file(path: str) -> str:
    digest = sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare_workspace_draft(
    root_dir: str,
    worktree_dir: str,
    run_id: str,
    parent_hash: str | None,
    base_train_source: str | None = None,
    platform_core: str = "auto",
) -> WorkspaceDraft:
    profile = build_platform_core_profile(root_dir, platform_core)
    workspace_path = os.path.join(worktree_dir, run_id)
    os.makedirs(workspace_path, exist_ok=True)

    for relative_path in IMMUTABLE_CORE_FILES:
        source = os.path.join(root_dir, relative_path)
        if os.path.exists(source):
            destination = os.path.join(workspace_path, relative_path)
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            shutil.copy2(source, destination)

    if profile.overlay_dir:
        for relative_path in PLATFORM_CORE_OVERRIDE_FILES:
            source = os.path.join(profile.overlay_dir, relative_path)
            if not os.path.exists(source):
                raise FileNotFoundError(f"Platform core {profile.name} is missing {relative_path}")
            destination = os.path.join(workspace_path, relative_path)
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            shutil.copy2(source, destination)
        lock_path = os.path.join(workspace_path, "uv.lock")
        if os.path.exists(lock_path):
            os.remove(lock_path)

    immutable_train = _read_text(os.path.join(workspace_path, "train.py"))
    base_train = base_train_source if base_train_source else immutable_train
    _write_text(os.path.join(workspace_path, "train.py"), base_train)
    produced_checkpoint_path = os.path.join(workspace_path, "artifacts", "final-model.pt")

    return WorkspaceDraft(
        run_id=run_id,
        workspace_path=workspace_path,
        platform_core=profile.name,
        immutable_train_contents=immutable_train,
        base_train_contents=base_train,
        produced_checkpoint_path=produced_checkpoint_path,
    )


def finalize_workspace(
    draft: WorkspaceDraft,
    parent_hash: str | None,
    iteration: int,
    train_contents: str,
    mutation_summary: str,
) -> PreparedWorkspace:
    _write_text(os.path.join(draft.workspace_path, "train.py"), train_contents)
    diff = unified_text_diff(draft.immutable_train_contents, train_contents)
    model_hash = sha256(train_contents.encode("utf-8")).hexdigest()

    metadata = {
        "run_id": draft.run_id,
        "parent_hash": parent_hash,
        "platform_core": draft.platform_core,
        "mutation_summary": mutation_summary,
        "iteration": iteration,
        "model_hash": model_hash,
        "produced_checkpoint_path": draft.produced_checkpoint_path,
    }
    _write_text(os.path.join(draft.workspace_path, "harness-run.json"), json.dumps(metadata, indent=2))

    return PreparedWorkspace(
        run_id=draft.run_id,
        workspace_path=draft.workspace_path,
        platform_core=draft.platform_core,
        train_contents=train_contents,
        diff=diff,
        mutation_summary=mutation_summary,
        model_hash=model_hash,
        produced_checkpoint_path=draft.produced_checkpoint_path,
    )


def prepare_workspace(
    root_dir: str,
    worktree_dir: str,
    run_id: str,
    parent_hash: str | None,
    iteration: int,
    base_train_source: str | None = None,
    platform_core: str = "auto",
) -> PreparedWorkspace:
    draft = prepare_workspace_draft(
        root_dir=root_dir,
        worktree_dir=worktree_dir,
        run_id=run_id,
        parent_hash=parent_hash,
        base_train_source=base_train_source,
        platform_core=platform_core,
    )
    updated_train, mutation_summary = next_mutation(parent_hash, iteration, draft.base_train_contents)
    return finalize_workspace(draft, parent_hash, iteration, updated_train, mutation_summary)


def simulate_metrics(run_id: str, diff: str, platform_core: str) -> dict[str, Any]:
    digest = sha256(f"{run_id}:{diff}".encode("utf-8")).digest()
    val_bpb = 0.97 + (digest[0] / 2550.0)
    return {
        "val_bpb": round(val_bpb, 6),
        "peak_vram_mb": 0.0,
        "training_seconds": 2.0,
        "total_seconds": 2.0,
        "execution_mode": "simulated",
        "platform_core": platform_core,
        "notes": "Synthetic metrics because the local environment is not ready for GPU training."
    }


def parse_train_output(log_text: str, platform_core: str) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "val_bpb": None,
        "peak_vram_mb": None,
        "training_seconds": None,
        "total_seconds": None,
        "execution_mode": "real",
        "platform_core": platform_core,
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
        return "completed", simulate_metrics(workspace.run_id, workspace.diff, workspace.platform_core), ""

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
                "platform_core": workspace.platform_core,
                "notes": output[-2000:],
            },
            output,
        )
    metrics = parse_train_output(output, workspace.platform_core)
    metrics["training_seconds"] = metrics.get("training_seconds") or elapsed
    metrics["total_seconds"] = metrics.get("total_seconds") or elapsed
    return "completed", metrics, output
