require("dotenv").config({ quiet: true });

const app = require("./app");
const db = require("./config/db");
const { validateEnv } = require("./config/env");
const { logger } = require("./utils/logger");

const PORT = process.env.PORT || 3001;
const SHUTDOWN_TIMEOUT_MS = 10000;

const startServer = async () => {
  try {
    validateEnv();

    const result = await db.query("SELECT NOW()");
    logger.info({
      msg: "database_connected",
      connectedAt: result.rows[0].now,
    });

    const server = app.listen(PORT, () => {
      logger.info({ msg: "server_started", port: Number(PORT) });
    });

    let shuttingDown = false;

    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;

      logger.info({ msg: "shutdown_started", signal });

      const forceExit = setTimeout(() => {
        logger.error({
          msg: "shutdown_timeout",
          timeoutMs: SHUTDOWN_TIMEOUT_MS,
        });
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);

      forceExit.unref();

      server.close(async (error) => {
        try {
          await db.pool.end();
        } catch (poolError) {
          logger.error({
            msg: "database_pool_close_failed",
            error: {
              name: poolError.name,
              message: poolError.message,
              stack: poolError.stack,
            },
          });
        } finally {
          clearTimeout(forceExit);

          if (error) {
            logger.error({
              msg: "http_server_close_failed",
              error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
              },
            });
            process.exit(1);
          }

          process.exit(0);
        }
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    return server;
  } catch (error) {
    logger.error({
      msg: "server_start_failed",
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
};
