from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SUMMARY_FILE_NAME = "harness-mutation-summary.txt"


@dataclass(frozen=True)
class MutationRequest:
    run_id: str
    workspace_path: str
    platform_core: str
    parent_hash: str | None
    iteration: int
    immutable_train_source: str
    base_train_source: str


@dataclass(frozen=True)
class MutationResult:
    train_contents: str
    mutation_summary: str
    backend: str


class MutationBackend:
    name = "mutation-backend"

    def mutate(self, request: MutationRequest) -> MutationResult:
        raise NotImplementedError


def _replace_numeric_constant(contents: str, name: str, transform) -> str:
    import re

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

    if 'WINDOW_PATTERN = "SSSL"' in original_contents:
        updated = original_contents.replace('WINDOW_PATTERN = "SSSL"', 'WINDOW_PATTERN = "LLLL"', 1)
        return updated, "switch WINDOW_PATTERN to LLLL"
    if 'WINDOW_PATTERN = "L"' in original_contents:
        updated = original_contents.replace('WINDOW_PATTERN = "L"', 'WINDOW_PATTERN = "LL"', 1)
        return updated, "switch WINDOW_PATTERN to LL"
    return original_contents, "preserve WINDOW_PATTERN fallback"


class HeuristicMutationBackend(MutationBackend):
    name = "heuristic"

    def mutate(self, request: MutationRequest) -> MutationResult:
        updated_train, summary = next_mutation(request.parent_hash, request.iteration, request.base_train_source)
        return MutationResult(train_contents=updated_train, mutation_summary=summary, backend=self.name)


def _platform_constraint(platform_core: str) -> str:
    if platform_core == "macos":
        return (
            "Keep the Apple Silicon / MPS execution path intact. Do not add CUDA-only dependencies, "
            "do not restore kernels/flash-attention imports, and preserve checkpoint env hooks."
        )
    return (
        "Keep the CUDA execution path intact. Preserve checkpoint env hooks and metric logging. "
        "Do not remove the flash-attention or kernels-based code path."
    )


def _mutation_prompt(request: MutationRequest) -> str:
    lineage = request.parent_hash[:12] if request.parent_hash else "baseline"
    return (
        "You are editing a disposable autoresearch experiment workspace.\n"
        "Change only train.py in the current working directory.\n"
        "Do not edit prepare.py, pyproject.toml, README.md, or files outside this workspace.\n"
        "Make exactly one focused, reversible experiment mutation intended to improve validation bpb "
        "during a short run.\n"
        f"{_platform_constraint(request.platform_core)}\n"
        "Preserve the script's existing checkpoint load/save env hooks and output metric lines.\n"
        "After editing, write one short sentence describing the mutation to "
        f"{SUMMARY_FILE_NAME}.\n"
        f"Platform core: {request.platform_core}\n"
        f"Parent lineage: {lineage}\n"
        f"Iteration: {request.iteration}\n"
    )


def _summary_path(workspace_path: str) -> Path:
    return Path(workspace_path, SUMMARY_FILE_NAME)


def _read_summary(workspace_path: str, fallback: str) -> str:
    summary_path = _summary_path(workspace_path)
    if summary_path.exists():
        summary = summary_path.read_text(encoding="utf-8").strip()
        if summary:
            return summary.splitlines()[0]
    return fallback


def _read_train_contents(workspace_path: str) -> str:
    return Path(workspace_path, "train.py").read_text(encoding="utf-8")


def _codex_args() -> list[str]:
    args = ["exec"]
    model = os.environ.get("CODEX_MODEL", "").strip()
    if model:
        args.extend(["--model", model])
    sandbox = (
        os.environ.get("HARNESS_CODEX_SANDBOX_MODE", "").strip()
        or os.environ.get("CODEX_SANDBOX_MODE", "").strip()
        or "workspace-write"
    )
    if sandbox:
        args.extend(["--sandbox", sandbox])
    args.append("--skip-git-repo-check")
    return args


class CodexMutationBackend(MutationBackend):
    name = "codex"

    def __init__(self, timeout_seconds: int = 300) -> None:
        self.timeout_seconds = timeout_seconds

    def mutate(self, request: MutationRequest) -> MutationResult:
        if request.parent_hash is None:
            return HeuristicMutationBackend().mutate(request)

        if not shutil.which("codex"):
            raise RuntimeError("codex CLI is not available on PATH")

        prompt = _mutation_prompt(request)
        completed = subprocess.run(
            ["codex", *_codex_args()],
            cwd=request.workspace_path,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=self.timeout_seconds,
            check=False,
        )
        output = f"{completed.stdout}\n{completed.stderr}".strip()
        if completed.returncode != 0:
            raise RuntimeError(f"codex mutation failed: {output[-2000:]}")

        updated_train = _read_train_contents(request.workspace_path)
        if updated_train == request.base_train_source:
            raise RuntimeError("codex mutation completed without changing train.py")

        summary = _read_summary(request.workspace_path, "codex-driven train.py mutation")
        return MutationResult(train_contents=updated_train, mutation_summary=summary, backend=self.name)


def _post_json(url: str, payload: dict[str, Any], api_key: str | None, timeout_seconds: int) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"ApiKey {api_key}"
    request = Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urlopen(request, timeout=timeout_seconds) as response:
        return json.loads(response.read().decode("utf-8"))


class ErnestAgentMutationBackend(MutationBackend):
    name = "ernest-agent"

    def __init__(self, api_url: str, api_key: str | None = None, timeout_seconds: int = 300) -> None:
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    def mutate(self, request: MutationRequest) -> MutationResult:
        if request.parent_hash is None:
            return HeuristicMutationBackend().mutate(request)

        prompt = _mutation_prompt(request)
        payload = {
            "observation": {
                "timestamp": 0,
                "state": {
                    "user_message": prompt,
                    "workspace_path": request.workspace_path,
                    "mutation_target": "train.py",
                },
                "events": ["autoresearch_swarm_mutation"],
            },
            "goal": {
                "id": f"mutation-{request.run_id}",
                "title": "Mutate train.py for the next autoresearch experiment",
                "description": prompt,
                "priority": 1,
                "horizon": "short",
                "candidateActions": [
                    {
                        "type": "invoke_codex",
                        "payload": {
                            "prompt": prompt,
                            "cwd": request.workspace_path,
                        },
                    },
                    {
                        "type": "read_file",
                        "payload": {"path": "train.py"},
                    },
                ],
            },
        }
        try:
            response = _post_json(
                f"{self.api_url}/agent/run-once",
                payload,
                self.api_key,
                self.timeout_seconds,
            )
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Ernest-Agent request failed: {exc.code} {body[-1000:]}") from exc
        except URLError as exc:
            raise RuntimeError(f"Ernest-Agent is unreachable at {self.api_url}: {exc.reason}") from exc

        updated_train = _read_train_contents(request.workspace_path)
        if updated_train == request.base_train_source:
            raise RuntimeError("Ernest-Agent completed without changing train.py")

        reasoning = response.get("decision", {}).get("reasoning") if isinstance(response, dict) else None
        summary = _read_summary(
            request.workspace_path,
            reasoning.splitlines()[0] if isinstance(reasoning, str) and reasoning.strip() else "Ernest-Agent train.py mutation",
        )
        return MutationResult(train_contents=updated_train, mutation_summary=summary, backend=self.name)


class AutoMutationBackend(MutationBackend):
    name = "auto"

    def __init__(self, ernest_url: str | None, ernest_api_key: str | None, codex_timeout_seconds: int, ernest_timeout_seconds: int) -> None:
        backends: list[MutationBackend] = []
        if ernest_url:
            backends.append(ErnestAgentMutationBackend(ernest_url, ernest_api_key, ernest_timeout_seconds))
        if shutil.which("codex"):
            backends.append(CodexMutationBackend(timeout_seconds=codex_timeout_seconds))
        backends.append(HeuristicMutationBackend())
        self.backends = backends

    def mutate(self, request: MutationRequest) -> MutationResult:
        errors: list[str] = []
        for backend in self.backends:
            try:
                return backend.mutate(request)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{backend.name}: {exc}")
        raise RuntimeError("; ".join(errors))


def build_mutation_backend(
    configured_backend: str,
    ernest_url: str | None = None,
    ernest_api_key: str | None = None,
    codex_timeout_seconds: int = 300,
    ernest_timeout_seconds: int = 300,
) -> MutationBackend:
    if configured_backend == "heuristic":
        return HeuristicMutationBackend()
    if configured_backend == "codex":
        return CodexMutationBackend(timeout_seconds=codex_timeout_seconds)
    if configured_backend == "ernest-agent":
        if not ernest_url:
            raise RuntimeError("HARNESS_ERNEST_AGENT_URL is required when HARNESS_AGENT_BACKEND=ernest-agent")
        return ErnestAgentMutationBackend(ernest_url, ernest_api_key, ernest_timeout_seconds)
    return AutoMutationBackend(ernest_url, ernest_api_key, codex_timeout_seconds, ernest_timeout_seconds)
