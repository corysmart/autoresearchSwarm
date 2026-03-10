import json
import tempfile
import unittest
from pathlib import Path

from harness_worker.core_adapter import cache_checkpoint_artifact, next_mutation, prepare_workspace, simulate_metrics
from harness_worker.diffing import unified_text_diff


class CoreAdapterTests(unittest.TestCase):
    def test_unified_diff_has_headers(self) -> None:
        diff = unified_text_diff("a = 1\n", "a = 2\n")
        self.assertIn("--- a/train.py", diff)
        self.assertIn("+++ b/train.py", diff)

    def test_next_mutation_baseline_preserves_original(self) -> None:
        original = 'WINDOW_PATTERN = "SSSL"\n'
        updated, summary = next_mutation(None, 0, original)
        self.assertEqual(updated, original)
        self.assertIn("baseline", summary)

    def test_simulated_metrics_are_deterministic(self) -> None:
        first = simulate_metrics("run-1", "diff")
        second = simulate_metrics("run-1", "diff")
        self.assertEqual(first, second)

    def test_prepare_workspace_uses_parent_train_source(self) -> None:
        with tempfile.TemporaryDirectory() as root_dir, tempfile.TemporaryDirectory() as worktree_dir:
            for relative_path in [
                ".python-version",
                "README.md",
                "prepare.py",
                "program.md",
                "pyproject.toml",
                "train.py",
                "uv.lock",
            ]:
                path = Path(root_dir, relative_path)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('WINDOW_PATTERN = "SSSL"\nMATRIX_LR = 0.04\nWEIGHT_DECAY = 0.2\n', encoding="utf-8")

            workspace = prepare_workspace(
                root_dir=root_dir,
                worktree_dir=worktree_dir,
                run_id="run-1",
                parent_hash="parent-1",
                iteration=1,
                base_train_source='WINDOW_PATTERN = "LLLL"\nMATRIX_LR = 0.04\nWEIGHT_DECAY = 0.2\n',
            )

            self.assertIn('WINDOW_PATTERN = "LLLL"', workspace.train_contents)
            self.assertNotEqual(workspace.diff, "")

    def test_checkpoint_artifacts_are_promoted_by_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir, "source.pt")
            source.write_text(json.dumps({"checkpoint": 1}), encoding="utf-8")

            manifest = cache_checkpoint_artifact(str(source), str(Path(temp_dir, "checkpoints")))
            self.assertIsNotNone(manifest)
            self.assertEqual(len(manifest["checkpoint_hash"]), 64)
            promoted = Path(temp_dir, "checkpoints", f"{manifest['checkpoint_hash']}.pt")
            self.assertTrue(promoted.exists())


if __name__ == "__main__":
    unittest.main()
