# Security

## Security Philosophy

This harness assumes peers can be malicious. Public peering is built so remote data cannot become local execution authority. Private swarms deliberately relax that boundary for trusted operators by allowing authenticated code lineage and checkpoint inheritance.

## Network Modes

- `private-peered`: default and recommended mode for real swarm behavior; configured peers plus an optional shared network token gate, with authenticated `train.py` lineage and checkpoint sharing
- `local-only`: no peer traffic
- `peered`: signed metadata exchange with configured peers, metadata-only by policy
- `libp2p-experimental`: experimental alternate transport, not recommended for normal use

## Trust Boundaries

| Boundary | Trust level | Notes |
| --- | --- | --- |
| Upstream core in repo root | Trusted local contract | Used as immutable source for workspaces |
| Platform overlays in `platform_cores/` | Trusted local contract | Additive local variants, selected by platform policy |
| Worker | Trusted local process with limited responsibility | Can execute local experiments only |
| Local API | Trusted policy authority | Signs local records, stores trust state, exposes local-only control surface |
| Remote peers in `peered` mode | Untrusted | Can only provide signed metadata |
| Remote peers in `private-peered` mode | Trust-scoped | Can provide authenticated lineage that may later execute locally |
| Dashboard | Read-only local client | Can request local moderation actions through explicit API endpoints |
| Local mutation backends (`codex`, `ernest-agent`) | Trusted local tooling boundary | May mutate worktree-local `train.py`, but are never selected or prompted by peers |

## Allowed Peer Data

Public and local-only modes allow only signed metadata:

- discovery events
- experiment metadata
- leaderboard hints
- advisory reputation/report events

Private swarms add one more category:

- authenticated `train.py` lineage plus checkpoint manifests for completed experiments

Forbidden remote inputs in all open/public contexts:

- code patches
- prompts
- model binaries
- datasets
- shell instructions
- job definitions for local execution

Private swarms still forbid:

- shell instructions
- arbitrary job definitions
- unauthenticated code or artifact downloads
- checkpoint downloads outside the configured private policy

## Local Agent Backends

Mutation generation is local-only and has its own safety boundary:

- `heuristic` mutates `train.py` deterministically inside the worker
- `codex` runs the local Codex CLI against the disposable workspace only
- `ernest-agent` sends a local mutation request to Ernest-Agent, scoped to `worktrees/`

Important rule:

- peer data may influence which parent experiment is chosen in private mode
- peer data does not choose the local mutation backend
- peer data does not become an executable prompt or shell instruction

## Admission Controls

Every inbound peer event must pass:

- topic allowlist
- payload guard validation
- deterministic payload hash verification
- signature verification
- dedupe by event id
- per-peer rate limiting
- request size caps

Invalid messages create local security events and count toward automatic security disablement.

Private checkpoint downloads are also policy-gated:

- public mode refuses checkpoint artifact downloads
- private mode can require `X-Swarm-Private-Token`
- experimental libp2p remains unsupported and should be treated as untrusted transport research

## Moderation Model

There are two denylist paths:

### Security denylist

Automatic local enforcement based on objective violations:

- malformed payloads
- invalid signatures
- forbidden topic usage
- replay/rate abuse

### Reputation denylist

Local operator-driven enforcement based on ratings/reports submitted through the UI or local API.

Remote reports are advisory only. They are stored and visible, but they do not directly disable peers.

## Private Swarms

Private swarms are the hedge against public-network risk:

- peers are explicitly configured
- private peering is a distinct runtime mode
- a shared token can be required for sync requests
- only private mode allows remote lineage to become scheduler input
- the same local trust and moderation rules still apply

Important limitation:

- a shared token is an admission gate, not a substitute for trust
- if you do not trust the operators on the other side, do not use private inheritance with them

## Experimental libp2p Mode

An alternate `libp2p-experimental` mode exists behind `HARNESS_ALLOW_LIBP2P_EXPERIMENTAL=1`.

Use it only for transport experiments. The recommended operational posture remains:

1. `private-peered` by default
2. `local-only` when you want zero network participation
3. `peered` only when you intentionally want public-style connectivity
4. `libp2p-experimental` only for targeted testing

## Disabled Peer Behavior

When a node is locally disabled:

- future peer sync is ignored
- it is excluded from normal swarm views
- its state remains visible in trust/audit views

## Operational Guidance

- Run peering only when you intend to participate in a local swarm.
- Use `peered` only for metadata visibility, not for cooperative inheritance.
- Use `private-peered` only with operators whose code lineage you are willing to inherit.
- Keep the API bound to localhost unless you explicitly need otherwise.
- Use `HARNESS_EXECUTION_MODE=simulated` for development and CI.
- On Apple Silicon, prefer `HARNESS_PLATFORM_CORE=auto` or `macos` so the MPS overlay is selected.
- Use `HARNESS_AGENT_BACKEND=heuristic` if you want a fully dependency-free local worker path.
- Review the Observability and Trust pages regularly if peering is enabled.
