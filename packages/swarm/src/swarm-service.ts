import { randomUUID } from "node:crypto";

import {
  SWARM_TOPICS,
  buildExperimentHash,
  buildPayloadHash,
  isDiscoveryEvent,
  isExperimentRecord,
  isLeaderboardEvent,
  isReputationReport,
  isSignedEnvelope,
  sha256Hex,
  stableStringify,
  type DiscoveryEvent,
  type ExperimentRecord,
  type LeaderboardEvent,
  type ReputationReport,
  type RuntimeMode,
  type SignedEnvelope,
  type SwarmTopic
} from "../../contracts/src/index.ts";
import type { HarnessConfig } from "../../api/src/config.ts";
import type { HarnessDatabase } from "../../api/src/database.ts";
import type { EventStreamBroker } from "../../api/src/event-stream.ts";
import type { NodeIdentity } from "../../api/src/identity.ts";
import { verifySignature } from "../../api/src/identity.ts";
import { ExperimentalLibp2pTransport } from "./libp2p-experimental.ts";

type AcceptedPayload = DiscoveryEvent | ExperimentRecord | LeaderboardEvent | ReputationReport;

interface SyncResponse {
  accepted: number;
  rejected: number;
  events: Array<SignedEnvelope<AcceptedPayload>>;
}

export class SwarmService {
  private syncTimer: NodeJS.Timeout | null = null;
  private readonly rateWindow = new Map<string, number[]>();
  private readonly experimentalTransport: ExperimentalLibp2pTransport;

  constructor(
    private readonly db: HarnessDatabase,
    private readonly config: HarnessConfig,
    private readonly identity: NodeIdentity,
    private readonly events: EventStreamBroker
  ) {
    this.experimentalTransport = new ExperimentalLibp2pTransport(
      config,
      db,
      events,
      this.ingestEnvelope.bind(this)
    );
  }

  start(): void {
    const mode = this.db.getRuntimeMode(this.config.runtimeMode);
    if (mode === "peered" || mode === "private-peered") {
      this.ensureSyncLoop();
      void this.announceDiscovery();
    } else if (mode === "libp2p-experimental") {
      if (this.config.allowExperimentalLibp2p) {
        void this.startExperimentalMode();
      } else {
        this.db.setRuntimeMode("private-peered");
        this.db.appendAuditEvent(
          "swarm",
          "warn",
          "libp2p_experimental_reverted",
          "libp2p-experimental was configured but not allowed; reverting to private-peered."
        );
        this.ensureSyncLoop();
        void this.announceDiscovery();
      }
    }
  }

  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    void this.experimentalTransport.stop();
  }

  runtimeMode(): RuntimeMode {
    return this.db.getRuntimeMode(this.config.runtimeMode);
  }

  enablePeering(): void {
    void this.experimentalTransport.stop();
    this.db.setRuntimeMode("peered");
    this.db.appendAuditEvent("swarm", "info", "runtime_mode", "Peering enabled");
    this.ensureSyncLoop();
    void this.announceDiscovery();
  }

  enablePrivatePeering(): void {
    void this.experimentalTransport.stop();
    this.db.setRuntimeMode("private-peered");
    this.db.appendAuditEvent("swarm", "info", "runtime_mode", "Private peering enabled");
    this.ensureSyncLoop();
    void this.announceDiscovery();
  }

  async enableExperimentalLibp2p(): Promise<boolean> {
    if (!this.config.allowExperimentalLibp2p) {
      this.db.appendAuditEvent(
        "swarm",
        "warn",
        "libp2p_experimental_blocked",
        "Attempted to enable experimental libp2p without HARNESS_ALLOW_LIBP2P_EXPERIMENTAL=1"
      );
      return false;
    }
    this.db.setRuntimeMode("libp2p-experimental");
    this.db.appendAuditEvent(
      "swarm",
      "warn",
      "runtime_mode",
      "Experimental libp2p peering enabled. This mode is not recommended."
    );
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    try {
      await this.startExperimentalMode();
    } catch (error) {
      this.db.setRuntimeMode("private-peered");
      this.db.appendAuditEvent(
        "swarm",
        "error",
        "libp2p_experimental_failed",
        "Experimental libp2p failed to start; reverted to private-peered.",
        { error: String(error) }
      );
      return false;
    }
    return true;
  }

  disablePeering(): void {
    this.db.setRuntimeMode("local-only");
    this.db.appendAuditEvent("swarm", "info", "runtime_mode", "Peering disabled");
    void this.experimentalTransport.stop();
    this.stop();
  }

  createEnvelope<TPayload extends AcceptedPayload>(
    topic: SwarmTopic,
    payload: TPayload
  ): SignedEnvelope<TPayload> {
    const timestamp = new Date().toISOString();
    const payloadHash = buildPayloadHash(payload);
    const nonce = randomUUID();
    const signingPayload = stableStringify({
      version: 1,
      topic,
      node_id: this.identity.nodeId,
      timestamp,
      nonce,
      payload_hash: payloadHash,
      payload
    });
    const signature = this.identity.signPayload(signingPayload);

    return {
      version: 1,
      event_id: `${payloadHash}:${nonce}`,
      topic,
      node_id: this.identity.nodeId,
      public_key: this.identity.publicKeyPem,
      timestamp,
      nonce,
      payload_hash: payloadHash,
      payload,
      signature
    };
  }

  async announceDiscovery(): Promise<void> {
    const payload: DiscoveryEvent = {
      node_id: this.identity.nodeId,
      base_url: this.config.publicBaseUrl,
      runtime_mode: this.runtimeMode(),
      can_train: process.env.HARNESS_CAN_TRAIN === "1",
      supports_simulation: true
    };
    await this.publishEnvelope(this.createEnvelope(SWARM_TOPICS.discovery, payload));
  }

  async publishExperiment(record: ExperimentRecord): Promise<void> {
    const mode = this.runtimeMode();
    const payload =
      mode === "peered"
        ? {
            ...record,
            train_source: "",
            checkpoint: record.checkpoint
              ? {
                  ...record.checkpoint,
                  checkpoint_url: ""
                }
              : null
          }
        : record;
    await this.publishEnvelope(this.createEnvelope(SWARM_TOPICS.experiment, payload));
    const leaderboard: LeaderboardEvent = { top: this.db.listLeaderboard(10, true) };
    await this.publishEnvelope(this.createEnvelope(SWARM_TOPICS.leaderboard, leaderboard));
  }

  async publishReputation(report: ReputationReport): Promise<void> {
    await this.publishEnvelope(this.createEnvelope(SWARM_TOPICS.reputation, report));
  }

  async publishEnvelope<TPayload extends AcceptedPayload>(envelope: SignedEnvelope<TPayload>): Promise<void> {
    this.db.saveSwarmEvent(envelope);
    this.events.broadcast({ event: "swarm-event", data: envelope });
    const mode = this.runtimeMode();
    if (mode === "peered" || mode === "private-peered") {
      await this.syncAllPeers([envelope]);
    } else if (mode === "libp2p-experimental") {
      await this.experimentalTransport.publish(envelope);
    }
  }

  async syncAllPeers(extraEvents: Array<SignedEnvelope<AcceptedPayload>> = []): Promise<void> {
    const recent = this.db.recentSwarmEvents(null, 50) as Array<SignedEnvelope<AcceptedPayload>>;
    const outgoing = dedupeEvents([...recent, ...extraEvents]);
    const peers = Array.from(new Set([...this.config.bootstrapPeers, ...this.db.listPeers().map((peer) => peer.base_url)]));
    await Promise.all(
      peers
        .filter((peerUrl) => peerUrl && peerUrl !== this.config.publicBaseUrl)
        .map(async (peerUrl) => {
          try {
            const response = await fetch(`${peerUrl}/api/internal/swarm/sync`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(this.runtimeMode() === "private-peered" && this.config.privateNetworkToken
                  ? { "X-Swarm-Private-Token": this.config.privateNetworkToken }
                  : {})
              },
              body: JSON.stringify({
                source: this.config.publicBaseUrl,
                events: outgoing
              })
            });
            if (!response.ok) {
              this.db.appendAuditEvent("swarm", "warn", "peer_sync_failed", `Peer sync failed for ${peerUrl}`);
              return;
            }
            const payload = (await response.json()) as SyncResponse;
            for (const envelope of payload.events) {
              this.ingestEnvelope(envelope, peerUrl);
            }
          } catch (error) {
            this.db.appendAuditEvent("swarm", "warn", "peer_sync_exception", String(error), { peerUrl });
          }
        })
    );
  }

  handleSyncRequest(
    source: string,
    envelopes: Array<SignedEnvelope<AcceptedPayload>>,
    privateToken: string | null
  ): SyncResponse {
    if (this.runtimeMode() === "libp2p-experimental") {
      this.db.appendAuditEvent(
        "swarm",
        "warn",
        "http_sync_rejected",
        "Rejected HTTP peer sync because libp2p experimental mode is active",
        { source }
      );
      return { accepted: 0, rejected: envelopes.length, events: [] };
    }
    if (this.runtimeMode() === "private-peered" && this.config.privateNetworkToken !== privateToken) {
      this.db.appendAuditEvent("swarm", "warn", "private_sync_rejected", "Rejected peer sync without valid private token", {
        source
      });
      return { accepted: 0, rejected: envelopes.length, events: [] };
    }
    let accepted = 0;
    let rejected = 0;
    for (const envelope of envelopes) {
      const result = this.ingestEnvelope(envelope, source);
      if (result) {
        accepted += 1;
      } else {
        rejected += 1;
      }
    }
    return {
      accepted,
      rejected,
      events: this.db.recentSwarmEvents(null, 50) as Array<SignedEnvelope<AcceptedPayload>>
    };
  }

  ingestEnvelope(envelope: SignedEnvelope<unknown>, source: string): boolean {
    if (this.db.hasSwarmEvent(envelope.event_id)) {
      return true;
    }
    if (!this.consumeRateAllowance(envelope.node_id)) {
      this.flagSecurityIssue(envelope.node_id, "rate_limit_abuse", `Inbound rate exceeded from ${source}`);
      return false;
    }
    if (!this.validateEnvelope(envelope)) {
      this.flagSecurityIssue(envelope.node_id, "invalid_envelope", `Invalid envelope from ${source}`);
      return false;
    }
    if (this.db.isNodeDisabled(envelope.node_id)) {
      return false;
    }
    this.db.saveSwarmEvent(envelope);

    switch (envelope.topic) {
      case SWARM_TOPICS.discovery:
        this.acceptDiscovery(envelope as SignedEnvelope<DiscoveryEvent>);
        break;
      case SWARM_TOPICS.experiment:
        this.acceptExperiment(envelope as SignedEnvelope<ExperimentRecord>);
        break;
      case SWARM_TOPICS.leaderboard:
        this.db.appendAuditEvent("swarm", "info", "leaderboard_hint", "Received advisory leaderboard", envelope.payload);
        break;
      case SWARM_TOPICS.reputation:
        this.acceptReputation(envelope as SignedEnvelope<ReputationReport>);
        break;
      default:
        this.flagSecurityIssue(envelope.node_id, "forbidden_topic", `Unsupported topic ${(envelope as SignedEnvelope<unknown>).topic}`);
        return false;
    }

    this.events.broadcast({ event: "swarm-event", data: envelope });
    return true;
  }

  private ensureSyncLoop(): void {
    if (this.syncTimer) {
      return;
    }
    this.syncTimer = setInterval(() => {
      void this.syncAllPeers();
    }, 15_000);
  }

  private async startExperimentalMode(): Promise<void> {
    await this.experimentalTransport.start();
    await this.announceDiscovery();
  }

  private consumeRateAllowance(nodeId: string): boolean {
    const now = Date.now();
    const cutoff = now - 60_000;
    const current = this.rateWindow.get(nodeId)?.filter((value) => value > cutoff) ?? [];
    current.push(now);
    this.rateWindow.set(nodeId, current);
    return current.length <= this.config.peerRateLimitPerMinute;
  }

  private validateEnvelope(envelope: SignedEnvelope<unknown>): envelope is SignedEnvelope<AcceptedPayload> {
    const payloadGuard = this.guardForTopic(envelope.topic);
    if (!payloadGuard || !isSignedEnvelope(envelope, payloadGuard)) {
      return false;
    }
    if (buildPayloadHash(envelope.payload) !== envelope.payload_hash) {
      return false;
    }
    const signingPayload = stableStringify({
      version: envelope.version,
      topic: envelope.topic,
      node_id: envelope.node_id,
      timestamp: envelope.timestamp,
      nonce: envelope.nonce,
      payload_hash: envelope.payload_hash,
      payload: envelope.payload
    });
    return verifySignature(envelope.public_key, signingPayload, envelope.signature);
  }

  private guardForTopic(topic: SwarmTopic): ((payload: unknown) => payload is AcceptedPayload) | null {
    switch (topic) {
      case SWARM_TOPICS.discovery:
        return isDiscoveryEvent;
      case SWARM_TOPICS.experiment:
        return isExperimentRecord;
      case SWARM_TOPICS.leaderboard:
        return isLeaderboardEvent;
      case SWARM_TOPICS.reputation:
        return isReputationReport;
      default:
        return null;
    }
  }

  private acceptDiscovery(envelope: SignedEnvelope<DiscoveryEvent>): void {
    this.db.saveDiscovery(envelope.payload);
    this.db.addFeedItem({
      id: envelope.event_id,
      type: "discovery",
      title: `Node ${envelope.payload.node_id} announced itself`,
      detail: `${envelope.payload.base_url} (${envelope.payload.runtime_mode})`,
      node_id: envelope.payload.node_id,
      timestamp: envelope.timestamp,
      origin: "remote-advisory"
    });
  }

  private acceptExperiment(envelope: SignedEnvelope<ExperimentRecord>): void {
    const allowExecutableLineage = this.runtimeMode() === "private-peered" || this.runtimeMode() === "libp2p-experimental";
    const record = {
      ...envelope.payload,
      train_source: allowExecutableLineage ? envelope.payload.train_source : "",
      checkpoint: allowExecutableLineage ? envelope.payload.checkpoint : null,
      origin: "remote_authenticated" as const
    };
    const expectedHash = buildExperimentHash({
      parent_hash: record.parent_hash,
      diff: record.diff,
      metrics: record.metrics,
      model_hash: record.model_hash,
      checkpoint_hash: envelope.payload.checkpoint?.checkpoint_hash ?? null,
      mutation_summary: record.mutation_summary,
      timestamp: record.timestamp,
      node_id: record.node_id
    });
    if (expectedHash !== record.experiment_hash) {
      this.flagSecurityIssue(record.node_id, "experiment_hash_mismatch", record.experiment_hash);
      return;
    }
    if (record.train_source && sha256Hex(record.train_source) !== record.model_hash) {
      this.flagSecurityIssue(record.node_id, "model_hash_mismatch", record.experiment_hash);
      return;
    }
    if (record.checkpoint && record.checkpoint.produced_by_node_id !== record.node_id) {
      this.flagSecurityIssue(record.node_id, "checkpoint_provenance_mismatch", record.experiment_hash);
      return;
    }
    this.db.saveExperiment(record);
    this.db.addFeedItem({
      id: envelope.event_id,
      type: "experiment",
      title: `Remote experiment from ${record.node_id}`,
      detail: `${record.mutation_summary} (${record.metrics.execution_mode})`,
      node_id: record.node_id,
      timestamp: record.timestamp,
      origin: "remote_authenticated"
    });
  }

  private acceptReputation(envelope: SignedEnvelope<ReputationReport>): void {
    const report = { ...envelope.payload, scope: "remote-advisory" as const };
    this.db.addReputationReport(report);
    this.db.addFeedItem({
      id: envelope.event_id,
      type: "trust",
      title: `Advisory report for ${report.reported_node_id}`,
      detail: `${report.trust_type}: ${report.reason}`,
      node_id: report.reported_node_id,
      timestamp: report.timestamp,
      origin: "remote-advisory"
    });
  }

  private flagSecurityIssue(nodeId: string, reason: string, detail: string): void {
    const trust = this.db.recordSecurityViolation(nodeId, reason, detail);
    if (trust.security_violations >= this.config.securityDisableThreshold) {
      this.db.disableNode(nodeId, `Security threshold exceeded: ${reason}`, "security");
    }
  }
}

function dedupeEvents(events: Array<SignedEnvelope<AcceptedPayload>>): Array<SignedEnvelope<AcceptedPayload>> {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.event_id)) {
      return false;
    }
    seen.add(event.event_id);
    return true;
  });
}
