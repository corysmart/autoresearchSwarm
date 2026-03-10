import { createApiState } from "./state.ts";
import { createApiServer } from "./server.ts";

const state = createApiState(process.cwd());
state.swarm.start();

const server = createApiServer(state);
server.listen(state.config.apiPort, state.config.apiHost, () => {
  state.db.appendAuditEvent("api", "info", "server_listening", "API listening", {
    host: state.config.apiHost,
    port: state.config.apiPort
  });
  console.log(`API listening on http://${state.config.apiHost}:${state.config.apiPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    state.swarm.stop();
    server.close(() => {
      process.exit(0);
    });
  });
}
