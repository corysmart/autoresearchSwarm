import os
import tempfile
import unittest
from pathlib import Path

from harness_worker.env_loader import load_local_env


class EnvLoaderTests(unittest.TestCase):
    def test_load_local_env_applies_default_then_local_override(self) -> None:
        original_backend = os.environ.get("HARNESS_AGENT_BACKEND")
        original_mode = os.environ.get("HARNESS_RUNTIME_MODE")
        original_port = os.environ.get("HARNESS_ERNEST_AGENT_PORT")

        try:
            os.environ.pop("HARNESS_AGENT_BACKEND", None)
            os.environ["HARNESS_RUNTIME_MODE"] = "local-only"
            os.environ.pop("HARNESS_ERNEST_AGENT_PORT", None)

            with tempfile.TemporaryDirectory() as root_dir:
                Path(root_dir, ".env.local.default").write_text(
                    "HARNESS_AGENT_BACKEND=ernest-agent\n"
                    "HARNESS_ERNEST_AGENT_PORT=4310\n"
                    "HARNESS_RUNTIME_MODE=private-peered\n",
                    encoding="utf-8",
                )
                Path(root_dir, ".env.local").write_text(
                    "HARNESS_AGENT_BACKEND=codex\n",
                    encoding="utf-8",
                )

                load_local_env(root_dir)

                self.assertEqual(os.environ.get("HARNESS_AGENT_BACKEND"), "codex")
                self.assertEqual(os.environ.get("HARNESS_ERNEST_AGENT_PORT"), "4310")
                self.assertEqual(os.environ.get("HARNESS_RUNTIME_MODE"), "local-only")
        finally:
            if original_backend is None:
                os.environ.pop("HARNESS_AGENT_BACKEND", None)
            else:
                os.environ["HARNESS_AGENT_BACKEND"] = original_backend
            if original_mode is None:
                os.environ.pop("HARNESS_RUNTIME_MODE", None)
            else:
                os.environ["HARNESS_RUNTIME_MODE"] = original_mode
            if original_port is None:
                os.environ.pop("HARNESS_ERNEST_AGENT_PORT", None)
            else:
                os.environ["HARNESS_ERNEST_AGENT_PORT"] = original_port


if __name__ == "__main__":
    unittest.main()
