import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from harness_worker.agent_backends import (
    AutoMutationBackend,
    CodexMutationBackend,
    ErnestAgentMutationBackend,
    HeuristicMutationBackend,
    MutationRequest,
)


def build_request(workspace_path: str, parent_hash: str | None = "parent-1") -> MutationRequest:
    train_source = 'WINDOW_PATTERN = "SSSL"\nMATRIX_LR = 0.04\nWEIGHT_DECAY = 0.2\n'
    Path(workspace_path, "train.py").write_text(train_source, encoding="utf-8")
    return MutationRequest(
        run_id="run-1",
        workspace_path=workspace_path,
        platform_core="default",
        parent_hash=parent_hash,
        iteration=1,
        immutable_train_source=train_source,
        base_train_source=train_source,
    )


class MutationBackendTests(unittest.TestCase):
    def test_heuristic_backend_preserves_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_path:
            request = build_request(workspace_path, parent_hash=None)
            result = HeuristicMutationBackend().mutate(request)
        self.assertEqual(result.backend, "heuristic")
        self.assertEqual(result.train_contents, request.base_train_source)
        self.assertIn("baseline", result.mutation_summary)

    def test_codex_backend_uses_summary_file_and_train_contents(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_path:
            request = build_request(workspace_path)
            Path(workspace_path, "harness-mutation-summary.txt").write_text(
                "reduce weight decay slightly\n",
                encoding="utf-8",
            )

            def fake_run(*args, **kwargs):
                Path(workspace_path, "train.py").write_text(
                    'WINDOW_PATTERN = "SSSL"\nMATRIX_LR = 0.04\nWEIGHT_DECAY = 0.18\n',
                    encoding="utf-8",
                )
                return MagicMock(returncode=0, stdout="ok", stderr="")

            with patch("harness_worker.agent_backends.shutil.which", return_value="/usr/local/bin/codex"):
                with patch("harness_worker.agent_backends.subprocess.run", side_effect=fake_run):
                    result = CodexMutationBackend(timeout_seconds=1).mutate(request)

        self.assertEqual(result.backend, "codex")
        self.assertIn("WEIGHT_DECAY = 0.18", result.train_contents)
        self.assertEqual(result.mutation_summary, "reduce weight decay slightly")

    def test_auto_backend_falls_back_to_heuristic_when_codex_missing(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_path:
            request = build_request(workspace_path)
            with patch("harness_worker.agent_backends.shutil.which", return_value=None):
                result = AutoMutationBackend(None, None, 1, 1).mutate(request)

        self.assertEqual(result.backend, "heuristic")
        self.assertNotEqual(result.train_contents, request.base_train_source)

    def test_ernest_backend_reads_reasoning_when_summary_file_missing(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_path:
            request = build_request(workspace_path)

            def fake_post_json(url, payload, api_key, timeout_seconds):
                Path(workspace_path, "train.py").write_text(
                    'WINDOW_PATTERN = "LLLL"\nMATRIX_LR = 0.04\n',
                    encoding="utf-8",
                )
                return {"decision": {"reasoning": "switch to longer attention window\nextra"}}

            with patch("harness_worker.agent_backends._post_json", side_effect=fake_post_json):
                result = ErnestAgentMutationBackend("http://127.0.0.1:4310", None, 1).mutate(request)

        self.assertEqual(result.backend, "ernest-agent")
        self.assertEqual(result.mutation_summary, "switch to longer attention window")
        self.assertIn('WINDOW_PATTERN = "LLLL"', result.train_contents)


if __name__ == "__main__":
    unittest.main()
