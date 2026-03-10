from __future__ import annotations

from dataclasses import dataclass
import os

from .env_loader import load_local_env


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
    platform_core: str
    agent_backend: str
    ernest_agent_url: str | None
    ernest_agent_api_key: str | None
    codex_timeout_seconds: int
    ernest_timeout_seconds: int
    state_path: str
    private_network_token: str | None


def load_config() -> WorkerConfig:
    load_local_env()
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
        platform_core=os.environ.get("HARNESS_PLATFORM_CORE", "auto"),
        agent_backend=os.environ.get("HARNESS_AGENT_BACKEND", "auto"),
        ernest_agent_url=os.environ.get("HARNESS_ERNEST_AGENT_URL"),
        ernest_agent_api_key=os.environ.get("HARNESS_ERNEST_AGENT_API_KEY"),
        codex_timeout_seconds=int(os.environ.get("HARNESS_CODEX_TIMEOUT_SECONDS", "300")),
        ernest_timeout_seconds=int(os.environ.get("HARNESS_ERNEST_AGENT_TIMEOUT_SECONDS", "300")),
        state_path=os.path.join(data_dir, "worker-state.json"),
        private_network_token=os.environ.get("SWARM_PRIVATE_NETWORK_TOKEN"),
    )
