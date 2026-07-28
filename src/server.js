import "dotenv/config";
import { createServer } from "node:http";
import { app } from "./app.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { attachSocketServer, closeSocketServer } from "./realtime/socket.js";

const port = Number(process.env.PORT ?? 5000);
const httpServer = createServer(app);
attachSocketServer(httpServer);

const server = httpServer.listen(port, () => {
  logger.info({ port, environment: process.env.NODE_ENV ?? "development" }, "API started");
});

const shutdown = (signal) => {
  logger.info({ signal }, "Graceful shutdown started");
  server.close(async (error) => {
    if (error) {
      logger.error({ error }, "Graceful shutdown failed");
      process.exit(1);
    }

    await closeSocketServer();
    await prisma.$disconnect();
    logger.info("API stopped");
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ error }, "Uncaught exception");
  process.exit(1);
});
