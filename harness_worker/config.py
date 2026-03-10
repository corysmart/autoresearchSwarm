from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True)
class WorkerConfig:
    api_base_url: str
    root_dir: str
    data_dir: str
    worktree_dir: str
    checkpoints_dir: str
    checkpoint_cache_dir: str
    poll_seconds: int
    execution_mode: str
    state_path: str
    private_network_token: str | None


def load_config() -> WorkerConfig:
    root_dir = os.getcwd()
    worktree_dir = os.path.join(root_dir, os.environ.get("HARNESS_WORKTREE_DIR", "worktrees"))
    data_dir = os.path.join(root_dir, os.environ.get("HARNESS_DATA_DIR", "harness-data"))
    checkpoints_dir = os.path.join(data_dir, "checkpoints")
    checkpoint_cache_dir = os.path.join(data_dir, "checkpoint-cache")
    os.makedirs(worktree_dir, exist_ok=True)
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(checkpoints_dir, exist_ok=True)
    os.makedirs(checkpoint_cache_dir, exist_ok=True)

    return WorkerConfig(
        api_base_url=os.environ.get("HARNESS_API_BASE_URL", "http://127.0.0.1:4172"),
        root_dir=root_dir,
        data_dir=data_dir,
        worktree_dir=worktree_dir,
        checkpoints_dir=checkpoints_dir,
        checkpoint_cache_dir=checkpoint_cache_dir,
        poll_seconds=int(os.environ.get("HARNESS_WORKER_POLL_SECONDS", "10")),
        execution_mode=os.environ.get("HARNESS_EXECUTION_MODE", "auto"),
        state_path=os.path.join(data_dir, "worker-state.json"),
        private_network_token=os.environ.get("SWARM_PRIVATE_NETWORK_TOKEN"),
    )
