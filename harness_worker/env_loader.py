from __future__ import annotations

from pathlib import Path
import os


_loaded_root: str | None = None


def _strip_quotes(value: str) -> str:
    if len(value) >= 2 and ((value[0] == '"' and value[-1] == '"') or (value[0] == "'" and value[-1] == "'")):
        return value[1:-1]
    return value


def load_local_env(root_dir: str | None = None) -> None:
    global _loaded_root

    resolved_root = str(Path(root_dir or os.getcwd()).resolve())
    if _loaded_root == resolved_root:
        return

    initial_env = set(os.environ.keys())
    for file_name in (".env.local.default", ".env.local"):
        env_path = Path(resolved_root) / file_name
        if not env_path.exists():
            continue

        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            normalized = line[7:].strip() if line.startswith("export ") else line
            if "=" not in normalized:
                continue

            key, value = normalized.split("=", 1)
            key = key.strip()
            if not key or key in initial_env:
                continue

            os.environ[key] = _strip_quotes(value.strip())

    _loaded_root = resolved_root
