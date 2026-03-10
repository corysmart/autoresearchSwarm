import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import type { HarnessConfig } from "./config.ts";
import type {
  DiscoveryEvent,
  DiscoveryFeedItem,
  ExperimentRecord,
  GraphResponse,
  LeaderboardEntry,
  PlatformCore,
  ReputationReport,
  RuntimeMode,
  SignedEnvelope,
  StatsResponse,
  SwarmTopic,
  TrustRecord
} from "../../contracts/src/index.ts";

export interface AuditEvent {
  id: number;
  timestamp: string;
  source: string;
  severity: "info" | "warn" | "error";
  event_type: string;
  message: string;
  detail_json: string | null;
}

export interface WorkerRunRecord {
  run_id: string;
  experiment_hash: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary: string;
}

interface DbLeaderboardRow {
  experiment_hash: string;
  parent_hash: string | null;
  node_id: string;
  val_bpb: number | null;
  timestamp: string;
  mutation_summary: string;
  origin: "local_verified" | "remote_authenticated" | "quarantined";
  execution_mode: "real" | "simulated" | "blocked";
  platform_core: "default" | "macos";
  checkpoint_hash: string | null;
}

interface DbExperimentRow {
  experiment_hash: string;
  parent_hash: string | null;
  node_id: string;
  timestamp: string;
  status: string;
  origin: "local_verified" | "remote_authenticated" | "quarantined";
  execution_mode: "real" | "simulated" | "blocked";
  platform_core: "default" | "macos";
  val_bpb: number | null;
  peak_vram_mb: number | null;
  training_seconds: number | null;
  total_seconds: number | null;
  mutation_summary: string;
  diff: string;
  model_hash: string;
  train_source: string;
  checkpoint_hash: string | null;
  checkpoint_size_bytes: number | null;
  checkpoint_url: string | null;
  checkpoint_node_id: string | null;
  signature: string;
}

export class HarnessDatabase {
  private readonly db: DatabaseSync;

  constructor(private readonly config: HarnessConfig) {
    this.db = new DatabaseSync(join(config.dataDir, "swarm.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initialize();
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS experiments (
        experiment_hash TEXT PRIMARY KEY,
        parent_hash TEXT,
        node_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        origin TEXT NOT NULL,
        execution_mode TEXT NOT NULL,
        platform_core TEXT NOT NULL DEFAULT 'default',
        val_bpb REAL,
        peak_vram_mb REAL,
        training_seconds REAL,
        total_seconds REAL,
        mutation_summary TEXT NOT NULL,
        diff TEXT NOT NULL,
        model_hash TEXT NOT NULL,
        train_source TEXT NOT NULL DEFAULT '',
        checkpoint_hash TEXT,
        checkpoint_size_bytes INTEGER,
        checkpoint_url TEXT,
        checkpoint_node_id TEXT,
        signature TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS swarm_events (
        event_id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        node_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        public_key TEXT NOT NULL,
        signature TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS peers (
        node_id TEXT PRIMARY KEY,
        base_url TEXT NOT NULL,
        runtime_mode TEXT NOT NULL,
        can_train INTEGER NOT NULL,
        supports_simulation INTEGER NOT NULL,
        last_seen TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trust_state (
        node_id TEXT PRIMARY KEY,
        security_violations INTEGER NOT NULL DEFAULT 0,
        reputation_reports INTEGER NOT NULL DEFAULT 0,
        reputation_score REAL NOT NULL DEFAULT 0,
        disabled INTEGER NOT NULL DEFAULT 0,
        disable_reason TEXT,
        disable_reason_type TEXT,
        last_event_at TEXT
      );

      CREATE TABLE IF NOT EXISTS reports (
        report_id TEXT PRIMARY KEY,
        reporter_node_id TEXT NOT NULL,
        reported_node_id TEXT NOT NULL,
        trust_type TEXT NOT NULL,
        rating REAL NOT NULL,
        reason TEXT NOT NULL,
        scope TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        detail TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feed_items (
        id TEXT PRIMARY KEY,
        item_type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        node_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        origin TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        severity TEXT NOT NULL,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        detail_json TEXT
      );

      CREATE TABLE IF NOT EXISTS worker_runs (
        run_id TEXT PRIMARY KEY,
        experiment_hash TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        summary TEXT NOT NULL
      );
    `);
    this.ensureExperimentColumns();
  }

  private ensureExperimentColumns(): void {
    this.ensureColumn("experiments", "train_source", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("experiments", "checkpoint_hash", "TEXT");
    this.ensureColumn("experiments", "checkpoint_size_bytes", "INTEGER");
    this.ensureColumn("experiments", "checkpoint_url", "TEXT");
    this.ensureColumn("experiments", "checkpoint_node_id", "TEXT");
    this.ensureColumn("experiments", "platform_core", "TEXT NOT NULL DEFAULT 'default'");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private rowToExperiment(row: DbExperimentRow): ExperimentRecord {
    return {
      experiment_hash: row.experiment_hash,
      parent_hash: row.parent_hash,
      metrics: {
        val_bpb: row.val_bpb,
        peak_vram_mb: row.peak_vram_mb,
        training_seconds: row.training_seconds,
        total_seconds: row.total_seconds,
        execution_mode: row.execution_mode,
        platform_core: row.platform_core ?? "default"
      },
      model_hash: row.model_hash,
      train_source: row.train_source,
      timestamp: row.timestamp,
      node_id: row.node_id,
      signature: row.signature,
      status: row.status as ExperimentRecord["status"],
      mutation_summary: row.mutation_summary,
      diff: row.diff,
      checkpoint:
        row.checkpoint_hash && row.checkpoint_url && row.checkpoint_size_bytes
          ? {
              checkpoint_hash: row.checkpoint_hash,
              checkpoint_size_bytes: row.checkpoint_size_bytes,
              checkpoint_url: row.checkpoint_url,
              produced_by_node_id: row.checkpoint_node_id ?? row.node_id
            }
          : null,
      origin: row.origin
    };
  }

  setRuntimeMode(mode: RuntimeMode): void {
    this.setSetting("runtime_mode", mode);
  }

  getRuntimeMode(fallback: RuntimeMode): RuntimeMode {
    const stored = this.getSetting("runtime_mode");
    return stored === "peered" ||
      stored === "local-only" ||
      stored === "private-peered" ||
      stored === "libp2p-experimental"
      ? stored
      : fallback;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  hasSwarmEvent(eventId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM swarm_events WHERE event_id = ?").get(eventId);
    return Boolean(row);
  }

  saveSwarmEvent<TPayload>(envelope: SignedEnvelope<TPayload>): void {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO swarm_events (
          event_id, topic, node_id, timestamp, payload_hash, payload_json, public_key, signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        envelope.event_id,
        envelope.topic,
        envelope.node_id,
        envelope.timestamp,
        envelope.payload_hash,
        JSON.stringify(envelope.payload),
        envelope.public_key,
        envelope.signature
      );
  }

  recentSwarmEvents(since: string | null, limit = 100): Array<SignedEnvelope<unknown>> {
    const query = since
      ? this.db.prepare(
          `SELECT event_id, topic, node_id, timestamp, payload_hash, payload_json, public_key, signature
           FROM swarm_events
           WHERE timestamp > ?
           ORDER BY timestamp ASC
           LIMIT ?`
        )
      : this.db.prepare(
          `SELECT event_id, topic, node_id, timestamp, payload_hash, payload_json, public_key, signature
           FROM swarm_events
           ORDER BY timestamp DESC
           LIMIT ?`
        );

    const rows = (since ? query.all(since, limit) : query.all(limit)) as Array<{
      event_id: string;
      topic: SwarmTopic;
      node_id: string;
      timestamp: string;
      payload_hash: string;
      payload_json: string;
      public_key: string;
      signature: string;
    }>;

    return rows.map((row) => ({
      version: 1,
      event_id: row.event_id,
      topic: row.topic,
      node_id: row.node_id,
      timestamp: row.timestamp,
      nonce: row.event_id,
      payload_hash: row.payload_hash,
      payload: JSON.parse(row.payload_json),
      public_key: row.public_key,
      signature: row.signature
    }));
  }

  saveDiscovery(event: DiscoveryEvent): void {
    this.db
      .prepare(`
        INSERT INTO peers (node_id, base_url, runtime_mode, can_train, supports_simulation, last_seen)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          base_url = excluded.base_url,
          runtime_mode = excluded.runtime_mode,
          can_train = excluded.can_train,
          supports_simulation = excluded.supports_simulation,
          last_seen = excluded.last_seen
      `)
      .run(
        event.node_id,
        event.base_url,
        event.runtime_mode,
        event.can_train ? 1 : 0,
        event.supports_simulation ? 1 : 0,
        new Date().toISOString()
      );
    this.ensureTrustRow(event.node_id);
  }

  listPeers(): Array<DiscoveryEvent & { disabled: boolean }> {
    const rows = this.db
      .prepare(`
        SELECT peers.node_id, peers.base_url, peers.runtime_mode, peers.can_train, peers.supports_simulation,
               COALESCE(trust_state.disabled, 0) AS disabled
        FROM peers
        LEFT JOIN trust_state ON trust_state.node_id = peers.node_id
        ORDER BY peers.last_seen DESC
      `)
      .all() as Array<{
      node_id: string;
      base_url: string;
      runtime_mode: RuntimeMode;
      can_train: number;
      supports_simulation: number;
      disabled: number;
    }>;

    return rows.map((row) => ({
      node_id: row.node_id,
      base_url: row.base_url,
      runtime_mode: row.runtime_mode,
      can_train: row.can_train === 1,
      supports_simulation: row.supports_simulation === 1,
      disabled: row.disabled === 1
    }));
  }

  saveExperiment(record: ExperimentRecord): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO experiments (
          experiment_hash, parent_hash, node_id, timestamp, status, origin, execution_mode, platform_core, val_bpb,
          peak_vram_mb, training_seconds, total_seconds, mutation_summary, diff, model_hash, train_source,
          checkpoint_hash, checkpoint_size_bytes, checkpoint_url, checkpoint_node_id, signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.experiment_hash,
        record.parent_hash,
        record.node_id,
        record.timestamp,
        record.status,
        record.origin,
        record.metrics.execution_mode,
        record.metrics.platform_core ?? "default",
        record.metrics.val_bpb,
        record.metrics.peak_vram_mb,
        record.metrics.training_seconds,
        record.metrics.total_seconds,
        record.mutation_summary,
        record.diff,
        record.model_hash,
        record.train_source,
        record.checkpoint?.checkpoint_hash ?? null,
        record.checkpoint?.checkpoint_size_bytes ?? null,
        record.checkpoint?.checkpoint_url ?? null,
        record.checkpoint?.produced_by_node_id ?? null,
        record.signature
      );
  }

  listLeaderboard(limit = 50, includeDisabled = false): LeaderboardEntry[] {
    const rows = this.db
      .prepare(`
        SELECT experiments.experiment_hash, experiments.parent_hash, experiments.node_id, experiments.val_bpb,
               experiments.timestamp, experiments.mutation_summary, experiments.origin, experiments.execution_mode,
               experiments.platform_core,
               experiments.checkpoint_hash,
               COALESCE(trust_state.disabled, 0) AS disabled
        FROM experiments
        LEFT JOIN trust_state ON trust_state.node_id = experiments.node_id
        WHERE experiments.status = 'completed'
        ORDER BY (experiments.val_bpb IS NULL), experiments.val_bpb ASC, experiments.timestamp DESC
        LIMIT ?
      `)
      .all(limit) as Array<DbLeaderboardRow & { disabled: number }>;

    return rows
      .filter((row) => includeDisabled || row.disabled === 0)
      .map((row) => ({
        experiment_hash: row.experiment_hash,
        parent_hash: row.parent_hash,
        node_id: row.node_id,
        score: row.val_bpb,
        timestamp: row.timestamp,
        mutation_summary: row.mutation_summary,
        origin: row.origin,
        execution_mode: row.execution_mode,
        has_checkpoint: row.checkpoint_hash !== null
      }));
  }

  listGraph(): GraphResponse {
    const rows = this.db
      .prepare(`
        SELECT experiment_hash, parent_hash, val_bpb, node_id, origin, execution_mode, platform_core, mutation_summary
        FROM experiments
        ORDER BY timestamp DESC
        LIMIT 200
      `)
      .all() as Array<{
      experiment_hash: string;
      parent_hash: string | null;
      val_bpb: number | null;
      node_id: string;
      origin: "local_verified" | "remote_authenticated" | "quarantined";
      execution_mode: "real" | "simulated" | "blocked";
      platform_core: "default" | "macos";
      mutation_summary: string;
    }>;

    return {
      nodes: rows.map((row) => ({
        id: row.experiment_hash,
        label: row.mutation_summary,
        score: row.val_bpb,
        node_id: row.node_id,
        origin: row.origin,
        execution_mode: row.execution_mode
      })),
      edges: rows
        .filter((row) => row.parent_hash)
        .map((row) => ({
          id: `${row.parent_hash}->${row.experiment_hash}`,
          source: row.parent_hash as string,
          target: row.experiment_hash
        }))
    };
  }

  addFeedItem(item: DiscoveryFeedItem): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO feed_items (id, item_type, title, detail, node_id, timestamp, origin)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(item.id, item.type, item.title, item.detail, item.node_id, item.timestamp, item.origin);
  }

  listFeed(limit = 100): DiscoveryFeedItem[] {
    return this.db
      .prepare(`
        SELECT id, item_type AS type, title, detail, node_id, timestamp, origin
        FROM feed_items
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      .all(limit) as DiscoveryFeedItem[];
  }

  appendAuditEvent(
    source: string,
    severity: "info" | "warn" | "error",
    eventType: string,
    message: string,
    detail: unknown = null
  ): void {
    this.db
      .prepare(`
        INSERT INTO audit_events (timestamp, source, severity, event_type, message, detail_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(new Date().toISOString(), source, severity, eventType, message, detail === null ? null : JSON.stringify(detail));
  }

  listAuditEvents(limit = 200): AuditEvent[] {
    return this.db
      .prepare(`
        SELECT id, timestamp, source, severity, event_type, message, detail_json
        FROM audit_events
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(limit) as AuditEvent[];
  }

  startWorkerRun(runId: string, summary: string): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO worker_runs (run_id, experiment_hash, status, started_at, finished_at, summary)
        VALUES (?, NULL, 'running', ?, NULL, ?)
      `)
      .run(runId, new Date().toISOString(), summary);
  }

  finishWorkerRun(runId: string, status: string, summary: string, experimentHash: string | null): void {
    this.db
      .prepare(`
        UPDATE worker_runs
        SET status = ?, finished_at = ?, summary = ?, experiment_hash = ?
        WHERE run_id = ?
      `)
      .run(status, new Date().toISOString(), summary, experimentHash, runId);
  }

  listWorkerRuns(limit = 50): WorkerRunRecord[] {
    return this.db
      .prepare(`
        SELECT run_id, experiment_hash, status, started_at, finished_at, summary
        FROM worker_runs
        ORDER BY started_at DESC
        LIMIT ?
      `)
      .all(limit) as WorkerRunRecord[];
  }

  ensureTrustRow(nodeId: string): void {
    this.db
      .prepare(`
        INSERT INTO trust_state (node_id, security_violations, reputation_reports, reputation_score, disabled)
        VALUES (?, 0, 0, 0, 0)
        ON CONFLICT(node_id) DO NOTHING
      `)
      .run(nodeId);
  }

  recordSecurityViolation(nodeId: string, reason: string, detail: string): TrustRecord {
    this.ensureTrustRow(nodeId);
    const timestamp = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO security_events (node_id, reason, detail, timestamp)
        VALUES (?, ?, ?, ?)
      `)
      .run(nodeId, reason, detail, timestamp);
    this.db
      .prepare(`
        UPDATE trust_state
        SET security_violations = security_violations + 1,
            last_event_at = ?
        WHERE node_id = ?
      `)
      .run(timestamp, nodeId);

    this.appendAuditEvent("swarm", "warn", "security_violation", reason, { nodeId, detail });
    return this.getTrustRecord(nodeId);
  }

  addReputationReport(report: ReputationReport): TrustRecord {
    this.ensureTrustRow(report.reported_node_id);
    this.db
      .prepare(`
        INSERT OR REPLACE INTO reports (
          report_id, reporter_node_id, reported_node_id, trust_type, rating, reason, scope, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        report.report_id,
        report.reporter_node_id,
        report.reported_node_id,
        report.trust_type,
        report.rating,
        report.reason,
        report.scope,
        report.timestamp
      );
    if (report.scope === "local") {
      this.db
        .prepare(`
          UPDATE trust_state
          SET reputation_reports = reputation_reports + 1,
              reputation_score = reputation_score + ?,
              last_event_at = ?
          WHERE node_id = ?
        `)
        .run(report.rating, report.timestamp, report.reported_node_id);
    }
    this.appendAuditEvent("trust", "info", "reputation_report", report.reason, report);
    return this.getTrustRecord(report.reported_node_id);
  }

  disableNode(nodeId: string, reason: string, reasonType: "security" | "reputation"): void {
    this.ensureTrustRow(nodeId);
    this.db
      .prepare(`
        UPDATE trust_state
        SET disabled = 1,
            disable_reason = ?,
            disable_reason_type = ?,
            last_event_at = ?
        WHERE node_id = ?
      `)
      .run(reason, reasonType, new Date().toISOString(), nodeId);
  }

  getTrustRecord(nodeId: string): TrustRecord {
    this.ensureTrustRow(nodeId);
    const row = this.db
      .prepare(`
        SELECT node_id, security_violations, reputation_reports, reputation_score, disabled, disable_reason,
               disable_reason_type, last_event_at
        FROM trust_state
        WHERE node_id = ?
      `)
      .get(nodeId) as {
      node_id: string;
      security_violations: number;
      reputation_reports: number;
      reputation_score: number;
      disabled: number;
      disable_reason: string | null;
      disable_reason_type: "security" | "reputation" | null;
      last_event_at: string | null;
    };

    return {
      node_id: row.node_id,
      source: "local",
      security_violations: row.security_violations,
      reputation_reports: row.reputation_reports,
      reputation_score: row.reputation_score,
      disabled: row.disabled === 1,
      disable_reason: row.disable_reason,
      disable_reason_type: row.disable_reason_type,
      last_event_at: row.last_event_at
    };
  }

  listTrustRecords(): TrustRecord[] {
    const rows = this.db
      .prepare(`
        SELECT node_id, security_violations, reputation_reports, reputation_score, disabled, disable_reason,
               disable_reason_type, last_event_at
        FROM trust_state
        ORDER BY disabled DESC, security_violations DESC, reputation_reports DESC
      `)
      .all() as Array<{
      node_id: string;
      security_violations: number;
      reputation_reports: number;
      reputation_score: number;
      disabled: number;
      disable_reason: string | null;
      disable_reason_type: "security" | "reputation" | null;
      last_event_at: string | null;
    }>;

    return rows.map((row) => ({
      node_id: row.node_id,
      source: "local",
      security_violations: row.security_violations,
      reputation_reports: row.reputation_reports,
      reputation_score: row.reputation_score,
      disabled: row.disabled === 1,
      disable_reason: row.disable_reason,
      disable_reason_type: row.disable_reason_type,
      last_event_at: row.last_event_at
    }));
  }

  listReports(limit = 200): ReputationReport[] {
    return this.db
      .prepare(`
        SELECT report_id, reporter_node_id, reported_node_id, trust_type, rating, reason, scope, timestamp
        FROM reports
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      .all(limit) as ReputationReport[];
  }

  isNodeDisabled(nodeId: string): boolean {
    return this.getTrustRecord(nodeId).disabled;
  }

  schedulerParent(
    runtimeMode: RuntimeMode,
    executionMode: ExperimentRecord["metrics"]["execution_mode"],
    platformCore: PlatformCore = "default"
  ): ExperimentRecord | null {
    const allowRemoteInheritance = runtimeMode === "private-peered" || runtimeMode === "libp2p-experimental";
    const row = this.db
      .prepare(`
        SELECT experiments.experiment_hash, experiments.parent_hash, experiments.node_id, experiments.timestamp,
               experiments.status, experiments.origin, experiments.execution_mode, experiments.platform_core, experiments.val_bpb,
               experiments.peak_vram_mb, experiments.training_seconds, experiments.total_seconds,
               experiments.mutation_summary, experiments.diff, experiments.model_hash, experiments.train_source,
               experiments.checkpoint_hash, experiments.checkpoint_size_bytes, experiments.checkpoint_url,
               experiments.checkpoint_node_id, experiments.signature
        FROM experiments
        LEFT JOIN trust_state ON trust_state.node_id = experiments.node_id
        WHERE experiments.status = 'completed'
          AND experiments.execution_mode = ?
          AND COALESCE(experiments.platform_core, 'default') = ?
          AND COALESCE(trust_state.disabled, 0) = 0
          AND (
            experiments.origin = 'local_verified'
            OR (
              ? = 1
              AND experiments.origin = 'remote_authenticated'
              AND experiments.train_source <> ''
              AND experiments.checkpoint_hash IS NOT NULL
              AND experiments.checkpoint_url IS NOT NULL
            )
          )
        ORDER BY
          CASE WHEN experiments.checkpoint_hash IS NULL THEN 1 ELSE 0 END,
          (experiments.val_bpb IS NULL),
          experiments.val_bpb ASC,
          CASE WHEN experiments.origin = 'local_verified' THEN 0 ELSE 1 END,
          experiments.timestamp DESC
        LIMIT 1
      `)
      .get(executionMode, platformCore, allowRemoteInheritance ? 1 : 0) as DbExperimentRow | undefined;

    return row ? this.rowToExperiment(row) : null;
  }

  buildStats(nodeId: string, runtimeMode: RuntimeMode): StatsResponse {
    const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const experimentsTotal = (
      this.db.prepare("SELECT COUNT(*) AS total FROM experiments").get() as { total: number }
    ).total;
    const peersOnline = (
      this.db.prepare(
        "SELECT COUNT(*) AS total FROM peers LEFT JOIN trust_state ON trust_state.node_id = peers.node_id WHERE COALESCE(trust_state.disabled, 0) = 0"
      ).get() as { total: number }
    ).total;
    const experimentsPerHour = (
      this.db
        .prepare("SELECT COUNT(*) AS total FROM experiments WHERE timestamp >= ?")
        .get(oneHourAgoIso) as { total: number }
    ).total;
    const [bestModel] = this.listLeaderboard(1);

    return {
      nodeId,
      runtimeMode,
      peersOnline,
      experimentsTotal,
      experimentsPerHour,
      bestModel: bestModel ?? null,
      localModeReason:
        runtimeMode === "local-only"
          ? "Networking is disabled until a local operator explicitly enables peering."
          : runtimeMode === "private-peered"
            ? "Private peering is enabled. Only configured peers with the shared token may sync."
            : runtimeMode === "libp2p-experimental"
              ? "Experimental libp2p mode is enabled. This transport is not recommended for normal use."
            : undefined
    };
  }
}
