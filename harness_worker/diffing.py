from __future__ import annotations

from difflib import unified_diff


def unified_text_diff(original: str, updated: str, file_name: str = "train.py") -> str:
    return "\n".join(
        unified_diff(
            original.splitlines(),
            updated.splitlines(),
            fromfile=f"a/{file_name}",
            tofile=f"b/{file_name}",
            lineterm="",
        )
    )
