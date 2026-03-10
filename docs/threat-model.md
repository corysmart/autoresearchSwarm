# Threat Model

## Assets

- local filesystem and credentials
- local experiment history
- node identity keys
- local trust/moderation decisions
- dashboard and observability data

## Adversaries

- malicious peers sending forged or malformed metadata
- noisy peers spamming discovery or experiment events
- peers attempting to poison leaderboards or trust signals
- accidental operator error while enabling peering or issuing local reports

## Primary Risks

### Remote execution escalation

Mitigation:

- public remote executable content is forbidden
- public peering strips executable lineage before storage
- private lineage inheritance is limited to configured peers and optional shared-token gating
- local API is the only route into execution records

### Spam and replay abuse

Mitigation:

- message size caps
- event id dedupe
- per-peer rate limiting
- local security violation tracking

### Reputation manipulation

Mitigation:

- remote reports are advisory only
- local enforcement is authoritative
- trust page shows the provenance of trust inputs

### Upstream sync regressions

Mitigation:

- additive harness architecture
- root core contract checks
- workspace-based execution model

## Residual Risk

- The current peer transport is HTTP-based sync, not a hardened libp2p overlay.
- Private swarms intentionally trade some isolation for real cooperation. If you inherit `train.py` lineage from an untrusted peer, that risk is on the operator.
- Simulated execution mode is for development and CI and must not be confused with real benchmark quality.
- Local API remains a sensitive authority surface and should stay bound to localhost by default.
