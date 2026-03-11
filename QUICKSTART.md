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

Local configuration is layered:

- committed repo defaults live in `.env.local.default`
- machine-specific overrides belong in `.env.local`
- explicit shell exports still override both

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
- platform core: `auto` (`macos` on Apple Silicon, `default` elsewhere)
- agent backend: `auto` (Ernest-Agent if configured, then Codex CLI if available, then heuristic fallback)

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

## Platform Core Selection

The harness chooses the trainer core separately from execution mode:

- `HARNESS_PLATFORM_CORE=auto` picks `macos` on Apple Silicon and `default` everywhere else
- `HARNESS_PLATFORM_CORE=default` forces the root upstream CUDA-oriented core
- `HARNESS_PLATFORM_CORE=macos` forces the Apple Silicon / MPS overlay under `platform_cores/macos/`

Examples:

```bash
HARNESS_PLATFORM_CORE=macos npm run start
HARNESS_PLATFORM_CORE=default HARNESS_EXECUTION_MODE=simulated npm run start
```

The macOS overlay is derived from `miolini/autoresearch-macos` and is kept additive so the root upstream core remains syncable.

## Agent Backend Selection

The worker mutation step can be driven by a local agent backend:

- `HARNESS_AGENT_BACKEND=auto`
- `HARNESS_AGENT_BACKEND=heuristic`
- `HARNESS_AGENT_BACKEND=codex`
- `HARNESS_AGENT_BACKEND=ernest-agent`

`auto` behavior:

- prefer Ernest-Agent when `HARNESS_ERNEST_AGENT_URL` is configured
- otherwise prefer the local `codex` CLI when installed
- otherwise fall back to the built-in heuristic mutator

Direct Codex example:

```bash
HARNESS_AGENT_BACKEND=codex npm run start
```

Ernest-Agent example:

```bash
cat >> .env.local <<'EOF'
HARNESS_AGENT_BACKEND=ernest-agent
HARNESS_ERNEST_AGENT_ROOT=../Ernest Agent
HARNESS_ERNEST_AGENT_AUTO_START=1
HARNESS_ERNEST_AGENT_AUTO_BUILD=1
HARNESS_ERNEST_AGENT_PORT=4310
HARNESS_ERNEST_AGENT_URL=http://127.0.0.1:4310
HARNESS_ERNEST_AGENT_UI_ENABLED=1
EOF

npm run start
```

That keeps Ernest-Agent as a local opt-in instead of a committed repo default. With those overrides in place, the orchestrator:

- auto-starts Ernest-Agent on a local port
- scopes its file workspace root to `worktrees/`
- sends worker mutation requests over `POST /agent/run-once`
- builds both:

- Ernest server bundle via `npm run build`
- Ernest UI bundle via `npm run ui:build`

before launching the Ernest server, unless you explicitly disable that with `HARNESS_ERNEST_AGENT_AUTO_BUILD=0`.

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

When Ernest-Agent is enabled, its own local UI is also available at:

- `${HARNESS_ERNEST_AGENT_URL}/ui`

and embedded in the harness dashboard under the `Ernest Agent` view.

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
- platform-core-aware parent selection when mixed Linux/macOS nodes are present

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
