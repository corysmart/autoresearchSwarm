# Quick Start

## What You Are Running

This repo contains two layers:

- the upstream autoresearch core at the root
- the additive swarm harness in `packages/`, `apps/ui/`, and `harness_worker/`

The harness is the default entrypoint for local node operation. The upstream core entrypoints remain available for direct debugging and upstream compatibility checks.

## Install

```bash
npm install
```

If you want to use the original core directly, keep the upstream Python workflow available:

```bash
uv sync
uv run prepare.py
uv run train.py
```

## Start The Full Harness

```bash
npm run start
```

This starts:

- API: `http://127.0.0.1:4172`
- UI: `http://127.0.0.1:4173`
- worker: local experiment loop
- peer sync: `private-peered` by default
- checkpoint inheritance: enabled only for trusted private swarms

## Runtime Modes

### Private-peered mode

Default behavior:

- worker runs locally
- peer sync uses the private swarm policy
- a shared token can gate inbound sync
- authenticated private peers can contribute parent `train.py` lineage and checkpoint manifests
- the scheduler may choose the best private authenticated parent for the current execution mode
- public peering is off unless explicitly enabled

### Local-only mode

Default behavior:

- worker runs locally
- remote peering is off
- dashboard and API are available
- remote metadata is not ingested

### Peered mode

Enable public peering from the dashboard or the local API:

```bash
curl -X POST http://127.0.0.1:4172/api/local/peering/enable
```

Disable it:

```bash
curl -X POST http://127.0.0.1:4172/api/local/peering/disable
```

Bootstrap peers can be configured with:

```bash
export SWARM_BOOTSTRAP_PEERS="http://127.0.0.1:4272,http://127.0.0.1:4372"
```

Public peering keeps remote experiments metadata-only:

- remote experiments appear in the dashboard
- remote checkpoints are not downloadable
- remote `train.py` lineage is stripped before storage
- public peers do not become automatic parent experiments

### Private peered mode

Private peering is the safer hedge against public swarm risk:

```bash
export SWARM_BOOTSTRAP_PEERS="http://127.0.0.1:4272,http://127.0.0.1:4372"
export SWARM_PRIVATE_NETWORK_TOKEN="replace-me"
curl -X POST http://127.0.0.1:4172/api/local/peering/private
```

When `SWARM_PRIVATE_NETWORK_TOKEN` is configured, peer sync requests without the matching token are rejected.

Private mode is the real cooperative swarm mode:

- remote authenticated experiments can become scheduler parents
- the worker downloads checkpoint artifacts from trusted peers
- the worker inherits the parent `train.py` source before applying a local mutation

Because that mode can execute inherited code lineage, use it only with operators you trust.

### Experimental libp2p mode

This mode exists for experimentation only and is not recommended.

You must explicitly unlock it:

```bash
export HARNESS_ALLOW_LIBP2P_EXPERIMENTAL=1
export SWARM_LIBP2P_BOOTSTRAP_MULTIADDRS="/ip4/127.0.0.1/tcp/4001/p2p/<peer-id>"
curl -X POST http://127.0.0.1:4172/api/local/peering/libp2p-experimental
```

Warnings:

- the HTTP private swarm remains the recommended default
- libp2p mode has less operational hardening in this repo
- treat it as unsupported for production use

## Execution Modes

The worker uses `HARNESS_EXECUTION_MODE=auto` by default:

- `auto`: real runs when the environment looks ready, otherwise simulated runs
- `real`: always attempt the upstream trainer
- `simulated`: deterministic synthetic runs for local development and CI

Examples:

```bash
HARNESS_EXECUTION_MODE=simulated npm run start
HARNESS_EXECUTION_MODE=real npm run start
```

## Useful Endpoints

- `GET /health`
- `GET /api/swarm/stats`
- `GET /api/swarm/leaderboard`
- `GET /api/swarm/graph`
- `GET /api/swarm/discoveries`
- `GET /api/swarm/trust`
- `GET /api/observability/events`
- `GET /api/observability/runs`
- `GET /api/observability/health`
- `GET /api/artifacts/checkpoints/:hash` for private-swarm checkpoint fetches
- `GET /api/events` for SSE

## Two-Node Private Swarm Test

Terminal 1:

```bash
export HARNESS_API_PORT=4172
export HARNESS_UI_PORT=4173
export HARNESS_PUBLIC_BASE_URL=http://127.0.0.1:4172
export HARNESS_DATA_DIR=harness-data/node1
export HARNESS_WORKTREE_DIR=worktrees/node1
export SWARM_BOOTSTRAP_PEERS=http://127.0.0.1:4272
export SWARM_PRIVATE_NETWORK_TOKEN=dev-private-swarm
export HARNESS_EXECUTION_MODE=real
npm run start
```

Terminal 2:

```bash
export HARNESS_API_PORT=4272
export HARNESS_UI_PORT=4273
export HARNESS_PUBLIC_BASE_URL=http://127.0.0.1:4272
export HARNESS_DATA_DIR=harness-data/node2
export HARNESS_WORKTREE_DIR=worktrees/node2
export SWARM_BOOTSTRAP_PEERS=http://127.0.0.1:4172
export SWARM_PRIVATE_NETWORK_TOKEN=dev-private-swarm
export HARNESS_EXECUTION_MODE=simulated
npm run start
```

That setup proves:

- private peer discovery/sync
- remote experiments appearing on both dashboards
- remote checkpoint manifests propagating
- scheduler eligibility for private authenticated parents

## Test And Validation Commands

```bash
npm test
npm run test:full
npm run build
npm run check:core
npm run check:docs
```

## Upstream Core Commands

The root core remains available:

```bash
uv run prepare.py
uv run train.py
```

The harness never mutates those root files during experiment execution. It copies them into disposable workspaces under `worktrees/`.
