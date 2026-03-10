from __future__ import annotations

from dataclasses import dataclass
import os
import platform


PLATFORM_CORE_OVERRIDE_FILES = (
    "prepare.py",
    "pyproject.toml",
    "train.py",
)


@dataclass(frozen=True)
class PlatformCoreProfile:
    name: str
    overlay_dir: str | None


def resolve_platform_core(configured_profile: str) -> str:
    if configured_profile in {"default", "macos"}:
        return configured_profile

    system = platform.system()
    machine = platform.machine().lower()
    if system == "Darwin" and machine in {"arm64", "aarch64"}:
        return "macos"
    return "default"


def build_platform_core_profile(root_dir: str, configured_profile: str) -> PlatformCoreProfile:
    name = resolve_platform_core(configured_profile)
    overlay_dir = None if name == "default" else os.path.join(root_dir, "platform_cores", name)
    return PlatformCoreProfile(name=name, overlay_dir=overlay_dir)
