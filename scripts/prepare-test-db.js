require("dotenv").config();

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const { ensureTestDatabase } = require("./lib/testDatabase");

const projectRoot = path.resolve(__dirname, "..");

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL wajib diisi. Contoh: " +
        "postgresql://postgres:postgres@localhost:5432/fastshop_test?sslmode=disable",
    );
  }

  if (testDatabaseUrl === process.env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL tidak boleh sama dengan DATABASE_URL agar test tidak menyentuh database utama.",
    );
  }

  const databaseName = await ensureTestDatabase(testDatabaseUrl);
  console.log(`Test database siap: ${databaseName}`);

  const result = spawnSync(
    process.execPath,
    [require.resolve("node-pg-migrate/bin/node-pg-migrate"), "up"],
    {
      cwd: projectRoot,
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  console.log("Migration test database selesai.");
}

main().catch((error) => {
  console.error(`Gagal menyiapkan test database: ${error.message}`);
  process.exit(1);
});
