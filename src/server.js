require("dotenv").config({ quiet: true });

const app = require("./app");
const db = require("./config/db");
const { validateEnv } = require("./config/env");

const PORT = process.env.PORT || 3001;
const SHUTDOWN_TIMEOUT_MS = 10000;

const startServer = async () => {
  try {
    validateEnv();

    const result = await db.query("SELECT NOW()");
    console.log("✅ PostgreSQL Connected successfully at:", result.rows[0].now);

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });

    let shuttingDown = false;

    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(`${signal} diterima, menutup server...`);

      const forceExit = setTimeout(() => {
        console.error("Shutdown timeout, keluar paksa.");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);

      forceExit.unref();

      server.close(async (error) => {
        try {
          await db.pool.end();
        } catch (poolError) {
          console.error("Gagal menutup pool database:", poolError.message);
        } finally {
          clearTimeout(forceExit);

          if (error) {
            console.error("Gagal menutup HTTP server:", error.message);
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
    console.error("❌ Gagal menjalankan server:", error.message);
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
};
