# Testing

## Commands

```bash
npm test
npm run test:full
npm run test:unit
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:python
npm run build
npm run check:core
npm run check:docs
```

## Suite Layout

| Suite | Location | Purpose |
| --- | --- | --- |
| Unit | `tests/unit/` | contracts, swarm admission, UI rendering helpers, local policy |
| Integration | `tests/integration/` | API persistence, scheduler boundaries, checkpoint artifacts, internal contracts |
| Security | `tests/security/` | invalid envelopes, disable thresholds, trust boundary behavior |
| E2E | `tests/e2e/` | orchestrator startup, API/UI reachability, simulated local node flow |
| Python unit | `tests/python/unit/` | worker mutation, diffing, inherited source handling, checkpoint promotion helpers |

## Coverage Expectations

The harness is expected to keep all four layers covered:

- worker logic
- local API/service layer
- swarm admission control
- private-swarm inheritance path
- dashboard rendering behavior

Coverage is enforced socially through required suites and CI gates rather than a numeric threshold in the current implementation.

## CI Expectations

CI should run:

- `npm test`
- `npm run test:e2e`
- `npm run build`
- `npm run check:core`
- `npm run check:docs`

That combination catches:

- runtime regressions
- UI build breaks
- upstream core contract breaks
- checkpoint lineage regressions
- documentation drift
