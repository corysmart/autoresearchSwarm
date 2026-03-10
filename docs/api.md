# API

## Public Local Endpoints

### `GET /health`

Basic API health and current runtime mode.

### `GET /api/swarm/stats`

Returns:

- local node id
- runtime mode
- peers online
- experiments total
- experiments per hour
- best model summary

### `GET /api/swarm/leaderboard`

Returns locally computed leaderboard entries.

### `GET /api/swarm/graph`

Returns graph nodes and edges for the experiment DAG view.

### `GET /api/swarm/discoveries`

Returns discovery feed items merged from local experiments, peer discoveries, and trust events.

### `GET /api/swarm/peers`

Returns known peer metadata plus local disabled state.

### `GET /api/swarm/trust`

Returns local trust state plus stored reports.

### `GET /api/observability/events`

Returns audit events for the observability view.

### `GET /api/observability/runs`

Returns recent worker runs.

### `GET /api/observability/health`

Returns process-level health summary for the observability page.

### `GET /api/events`

SSE stream for live UI updates.

### `GET /api/artifacts/checkpoints/:hash`

Returns a checkpoint artifact by content hash.

Policy:

- available in `local-only`
- available in `private-peered`
- available in `libp2p-experimental`
- blocked in public `peered` mode
- requires `X-Swarm-Private-Token` when a private token is configured

## Local Control Endpoints

### `POST /api/local/peering/enable`

Enables peer sync and discovery announcements.

### `POST /api/local/peering/private`

Enables private peer sync. When `SWARM_PRIVATE_NETWORK_TOKEN` is set, sync requests must include a matching `X-Swarm-Private-Token` header.

### `POST /api/local/peering/libp2p-experimental`

Attempts to enable the experimental libp2p transport. This endpoint returns `409` unless `HARNESS_ALLOW_LIBP2P_EXPERIMENTAL=1` is set.

### `POST /api/local/peering/disable`

Disables peer sync.

### `POST /api/local/trust/report`

Submits a local authoritative report or rating:

```json
{
  "reported_node_id": "peer-123",
  "trust_type": "reputation",
  "rating": -1,
  "reason": "Repeatedly spammed low-quality results"
}
```

## Internal Worker Endpoints

### `GET /api/local/scheduler/next?execution_mode=real|simulated|blocked`

Returns the best eligible parent experiment and local node metadata for the worker.

Selection policy:

- `local-only`: local verified parents only
- `peered`: local verified parents only
- `private-peered`: local verified parents plus remote authenticated parents that include `train_source` and a checkpoint manifest
- `libp2p-experimental`: same policy as private mode, but over the unsupported experimental transport

### `POST /api/internal/worker/run-start`

Records worker run start in observability storage.

### `POST /api/internal/worker/run-finish`

Records worker run completion in observability storage.

### `POST /api/internal/local-experiments`

Accepts a local worker result, computes the canonical experiment hash, signs it, stores it, and publishes it locally.

The worker sends:

- metrics
- `train_source`
- diff
- mutation summary
- checkpoint hash/size when a checkpoint artifact was produced

## Internal Peer Endpoint

### `POST /api/internal/swarm/sync`

Accepts signed peer envelopes and returns recent signed local envelopes. This is the current v1 peer-sync transport.

When the runtime mode is `libp2p-experimental`, this HTTP sync surface is no longer the primary transport.
