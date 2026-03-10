from __future__ import annotations

from datetime import datetime, UTC
from pathlib import Path
import time
from urllib.parse import urlencode
from uuid import uuid4

from .agent_backends import MutationRequest, build_mutation_backend
from .client import ApiClient
from .config import load_config
from .core_adapter import (
    cache_checkpoint_artifact,
    checkpoint_file_path,
    ensure_platform_runtime,
    detect_execution_mode,
    finalize_workspace,
    prepare_workspace_draft,
    run_experiment,
)
from .platform_core import resolve_platform_core
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
    platform_core = resolve_platform_core(config.platform_core)
    mode = detect_execution_mode(config.execution_mode, platform_core)
    mutation_backend = build_mutation_backend(
        config.agent_backend,
        ernest_url=config.ernest_agent_url,
        ernest_api_key=config.ernest_agent_api_key,
        codex_timeout_seconds=config.codex_timeout_seconds,
        ernest_timeout_seconds=config.ernest_timeout_seconds,
    )
    if mode == "real":
        ensure_platform_runtime(config.root_dir, platform_core)

    while True:
        iteration = load_iteration(config.state_path)
        run_id = f"run-{uuid4().hex[:12]}"
        try:
            query = urlencode({"execution_mode": mode, "platform_core": platform_core})
            next_work = client.get_json(f"/api/local/scheduler/next?{query}")
            parent = next_work.get("parent")
            local_node_id = next_work.get("nodeId")
            parent_hash = parent["experiment_hash"] if parent else None
            parent_checkpoint_path = resolve_parent_checkpoint(client, config, local_node_id, parent)

            client.post_json(
                "/api/internal/worker/run-start",
                {
                    "run_id": run_id,
                    "summary": (
                        f"Preparing {platform_core} workspace in {mode} mode from "
                        f"{parent_hash[:12] if parent_hash else 'baseline'} via {config.agent_backend}"
                    ),
                },
            )

            draft = prepare_workspace_draft(
                root_dir=config.root_dir,
                worktree_dir=config.worktree_dir,
                run_id=run_id,
                parent_hash=parent_hash,
                base_train_source=parent.get("train_source") if parent else None,
                platform_core=platform_core,
            )
            mutation = mutation_backend.mutate(
                MutationRequest(
                    run_id=run_id,
                    workspace_path=draft.workspace_path,
                    platform_core=draft.platform_core,
                    parent_hash=parent_hash,
                    iteration=iteration,
                    immutable_train_source=draft.immutable_train_contents,
                    base_train_source=draft.base_train_contents,
                )
            )
            workspace = finalize_workspace(
                draft=draft,
                parent_hash=parent_hash,
                iteration=iteration,
                train_contents=mutation.train_contents,
                mutation_summary=mutation.mutation_summary,
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
                    "summary": f"{mutation.backend}: {workspace.mutation_summary}",
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
