# Upstream Sync

## Harness Philosophy

The harness is intentionally additive so this repo can keep consuming updates from the original autoresearch project.

The upstream core lives at the repo root and should remain the contract surface:

- `prepare.py`
- `train.py`
- `program.md`
- supporting root metadata like `pyproject.toml`

Platform-specific variants stay outside that contract surface under additive overlays:

- `platform_cores/macos/prepare.py`
- `platform_cores/macos/train.py`
- `platform_cores/macos/pyproject.toml`

The current macOS overlay is based on `miolini/autoresearch-macos` and should be updated independently of the root upstream sync flow.

## Expected Workflow

1. Add the original repo as `upstream`.
2. Fetch upstream changes.
3. Merge or rebase the root core changes.
4. Run the compatibility and test suite:

```bash
npm run check:core
npm test
npm run build
```

5. Update only the harness adapters if the upstream contract changed.
6. If the macOS overlay depends on upstream trainer changes, port those changes into `platform_cores/macos/` separately.

## Why The Worker Uses Disposable Workspaces

Disposable workspaces are the key upstream-safe integration technique:

- no root mutation during experiments
- clean diffs against the upstream contract
- no need to embed harness state into the upstream trainer
- checkpoint inheritance is passed in through minimal environment hooks instead of deep trainer rewrites

## Contract Drift Signals

The current compatibility check treats the following tokens as contract markers:

- `train.py`: `TOTAL_BATCH_SIZE`, `MATRIX_LR`, `WINDOW_PATTERN`
- `prepare.py`: `MAX_SEQ_LEN`, `TIME_BUDGET`, `evaluate_bpb`

The harness also relies on the minimal checkpoint hooks in `train.py`:

- `AUTORESEARCH_LOAD_CHECKPOINT`
- `AUTORESEARCH_SAVE_CHECKPOINT`

If those disappear or move significantly, update the worker adapter and the compatibility checker together.

For Apple Silicon support, also watch for drift between:

- root `prepare.py` / `train.py`
- `platform_cores/macos/prepare.py` / `train.py`

The overlay should stay close to the upstream core plus the minimum macOS-specific deltas.
