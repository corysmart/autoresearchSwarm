import { loadHarnessConfig } from "./config.ts";
import { HarnessDatabase } from "./database.ts";
import { EventStreamBroker } from "./event-stream.ts";
import { loadNodeIdentity } from "./identity.ts";
import { SwarmService } from "../../swarm/src/swarm-service.ts";

export interface ApiState {
  config: ReturnType<typeof loadHarnessConfig>;
  db: HarnessDatabase;
  events: EventStreamBroker;
  identity: ReturnType<typeof loadNodeIdentity>;
  swarm: SwarmService;
}

export function createApiState(rootDir: string = process.cwd()): ApiState {
  const config = loadHarnessConfig(rootDir);
  const db = new HarnessDatabase(config);
  const events = new EventStreamBroker();
  const identity = loadNodeIdentity(config.dataDir);
  const swarm = new SwarmService(db, config, identity, events);

  db.appendAuditEvent("api", "info", "startup", "API state initialized", {
    nodeId: identity.nodeId,
    runtimeMode: db.getRuntimeMode(config.runtimeMode)
  });

  return { config, db, events, identity, swarm };
}
