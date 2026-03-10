from __future__ import annotations

import json
import os


def load_iteration(state_path: str) -> int:
    if not os.path.exists(state_path):
        return 0
    with open(state_path, "r", encoding="utf-8") as handle:
        state = json.load(handle)
    return int(state.get("iteration", 0))


def save_iteration(state_path: str, iteration: int) -> None:
    with open(state_path, "w", encoding="utf-8") as handle:
        json.dump({"iteration": iteration}, handle, indent=2)
