# Architecture

## Overview

The repo uses a layered harness architecture:

- upstream autoresearch core at the root
- additive harness modules in separate directories
- explicit contracts between worker, API, swarm, and UI

The most important invariant is that the root training files remain the integration contract, not the place where swarm logic is embedded.

## Module Responsibilities

| Module | Responsibility |
| --- | --- |
| `harness_worker/` | Local experiment loop, workspace snapshots, local mutation application, checkpoint restore/save, real/simulated execution |
| `packages/api/` | Config, identity, SQLite persistence, HTTP routes, observability, local trust policy |
| `packages/swarm/` | Signed metadata transport, admission control, rate limiting, dedupe, peer sync |
| `packages/contracts/` | Canonical message types, hashing, topic names, validation guards |
| `packages/orchestrator/` | Startup order, child process supervision, one-command local node bootstrap |
| `apps/ui/` | Local React dashboard for swarm state, moderation, and observability |

## Control Flow

1. Orchestrator starts the API.
2. API loads config, identity, SQLite, and swarm state.
3. Orchestrator starts the Python worker and the UI.
4. Worker requests the next eligible parent experiment from the API for its execution mode.
5. In `private-peered` mode the API may return a remote authenticated parent if it includes a checkpoint manifest and full `train.py` lineage.
6. Worker snapshots the immutable core into a disposable workspace.
7. Worker applies the parent `train.py` lineage, mutates it locally, restores a parent checkpoint when available, and runs a real or simulated experiment.
8. Worker promotes the resulting checkpoint into the node-local artifact store.
9. Worker posts structured results to the API.
10. API stores the experiment, projects UI views, emits SSE events, and optionally syncs signed envelopes to peers.

## Workspace Model

The worker never mutates the repo root. Instead it:

- copies the upstream core files into `worktrees/<run-id>/`
- writes local harness metadata into the worktree
- applies inherited `train.py` lineage when the selected parent provides it
- applies the next local mutation to the worktree copy of `train.py`
- computes the diff against the root `train.py`
- writes checkpoints to worktree-local artifacts before promoting them into `harness-data/checkpoints/`

This is the harness boundary that preserves upstream compatibility.

## Design Invariants

- Root core files are treated as immutable runtime inputs.
- The worker never ingests raw network data.
- The swarm layer never triggers experiment execution.
- The dashboard only reads from the local API.
- Public-mode remote metadata does not participate in automatic scheduling.
- Private-mode authenticated lineage may participate in automatic scheduling when checkpoints are available.
- Local trust policy is authoritative; remote trust data is advisory.
- Public peer traffic is non-executable metadata only.
- Private swarms are trust-scoped and may exchange full experiment lineage, including `train.py` source and checkpoint manifests.

## Observability Design

Observability is part of the architecture, not a separate debug layer:

- worker run history is stored in SQLite
- audit events are stored in SQLite
- SSE pushes live updates to the dashboard
- health, trust, and swarm state are all queryable through the API

This is intentionally similar to the Ernest-Agent operating model: the local operator should have a single page that explains what the system is doing and why.
