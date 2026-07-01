import Fastify from "fastify";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { betaLogicalNodeCluster } from "./beta-logical-node-cluster.js";

const app = Fastify({ logger: true });
await registerRoutes(app);
await betaLogicalNodeCluster.start().catch((error) => {
  app.log.warn({ error: error instanceof Error ? error.message : "unknown" }, "beta logical node cluster did not start");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void betaLogicalNodeCluster.stop().finally(() => process.exit(0));
  });
}

app.listen({ port: config.port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
