from __future__ import annotations

from datetime import datetime, UTC
from pathlib import Path
import time
from urllib.parse import urlencode
from uuid import uuid4

from .client import ApiClient
from .config import load_config
from .core_adapter import (
    cache_checkpoint_artifact,
    checkpoint_file_path,
    detect_execution_mode,
    prepare_workspace,
    run_experiment,
)
from .scheduler import load_iteration, save_iteration


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def resolve_parent_checkpoint(
    client: ApiClient,
    config,
    local_node_id: str,
    parent: dict | None,
) -> str | None:
    if not parent:
        return None

    checkpoint = parent.get("checkpoint")
    if not checkpoint:
        return None

    checkpoint_hash = checkpoint["checkpoint_hash"]
    local_path = checkpoint_file_path(config.checkpoints_dir, checkpoint_hash)
    if checkpoint.get("produced_by_node_id") == local_node_id:
        return local_path if Path(local_path).exists() else None

    cached_path = checkpoint_file_path(config.checkpoint_cache_dir, checkpoint_hash)
    if Path(cached_path).exists():
        return cached_path

    headers = (
        {"X-Swarm-Private-Token": config.private_network_token}
        if config.private_network_token
        else None
    )
    return client.download_file(checkpoint["checkpoint_url"], cached_path, headers=headers)


def main() -> None:
    config = load_config()
    client = ApiClient(config.api_base_url)
    mode = detect_execution_mode(config.execution_mode)

    while True:
        iteration = load_iteration(config.state_path)
        run_id = f"run-{uuid4().hex[:12]}"
        try:
            query = urlencode({"execution_mode": mode})
            next_work = client.get_json(f"/api/local/scheduler/next?{query}")
            parent = next_work.get("parent")
            local_node_id = next_work.get("nodeId")
            parent_hash = parent["experiment_hash"] if parent else None
            parent_checkpoint_path = resolve_parent_checkpoint(client, config, local_node_id, parent)

            client.post_json(
                "/api/internal/worker/run-start",
                {
                    "run_id": run_id,
                    "summary": f"Preparing workspace in {mode} mode from {parent_hash[:12] if parent_hash else 'baseline'}",
                },
            )

            workspace = prepare_workspace(
                root_dir=config.root_dir,
                worktree_dir=config.worktree_dir,
                run_id=run_id,
                parent_hash=parent_hash,
                iteration=iteration,
                base_train_source=parent.get("train_source") if parent else None,
            )
            status, metrics, output = run_experiment(workspace, mode, parent_checkpoint_path)
            checkpoint = cache_checkpoint_artifact(workspace.produced_checkpoint_path, config.checkpoints_dir)

            experiment = client.post_json(
                "/api/internal/local-experiments",
                {
                    "parent_hash": parent_hash,
                    "metrics": metrics,
                    "model_hash": workspace.model_hash,
                    "timestamp": now_iso(),
                    "status": status,
                    "mutation_summary": workspace.mutation_summary,
                    "diff": workspace.diff,
                    "train_source": workspace.train_contents,
                    "checkpoint": checkpoint,
                },
            )

            client.post_json(
                "/api/internal/worker/run-finish",
                {
                    "run_id": run_id,
                    "status": status,
                    "summary": workspace.mutation_summary if not output else workspace.mutation_summary,
                    "experiment_hash": experiment["experiment_hash"],
                },
            )
            save_iteration(config.state_path, iteration + 1)
        except Exception as exc:  # noqa: BLE001
            client.post_json(
                "/api/internal/worker/run-finish",
                {
                    "run_id": run_id,
                    "status": "failed",
                    "summary": f"worker failure: {exc}",
                    "experiment_hash": None,
                },
            )
        time.sleep(config.poll_seconds)


if __name__ == "__main__":
    main()
