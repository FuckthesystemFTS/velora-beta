import Fastify from "fastify";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";

const app = Fastify({ logger: true });
await registerRoutes(app);

app.listen({ port: config.port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
