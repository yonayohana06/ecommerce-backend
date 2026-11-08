const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { Client } = require("pg");

const {
  buildDatabaseUrl,
  getSslConfig,
  createDatabase,
  dropDatabase,
} = require("../../scripts/lib/testDatabase");

const runDbTests = process.env.RUN_DB_TESTS === "1";
const projectRoot = path.resolve(__dirname, "../..");
const migrationCli = require.resolve("node-pg-migrate/bin/node-pg-migrate");

const uniqueDatabaseName = () =>
  `fastshop_migration_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

test(
  "migration dari database kosong berhasil",
  { skip: !runDbTests, timeout: 120000 },
  async () => {
    const baseUrl = process.env.TEST_DATABASE_URL;
    const databaseName = uniqueDatabaseName();
    const migrationUrl = buildDatabaseUrl(baseUrl, databaseName);

    await createDatabase(baseUrl, databaseName);

    try {
      const result = spawnSync(
        process.execPath,
        [migrationCli, "up"],
        {
          cwd: projectRoot,
          env: { ...process.env, DATABASE_URL: migrationUrl },
          encoding: "utf8",
        },
      );

      assert.equal(
        result.status,
        0,
        `migrasi database kosong gagal:\n${result.stdout || ""}\n${
          result.stderr || ""
        }`,
      );

      const client = new Client({
        connectionString: migrationUrl,
        ssl: getSslConfig(baseUrl),
      });

      await client.connect();

      try {
        const tables = await client.query(
          `SELECT tablename
           FROM pg_tables
           WHERE schemaname = 'public'
           ORDER BY tablename`,
        );
        const tableNames = tables.rows.map((row) => row.tablename);

        for (const table of [
          "users",
          "categories",
          "products",
          "orders",
          "order_items",
          "cart_items",
          "pgmigrations",
        ]) {
          assert.ok(
            tableNames.includes(table),
            `tabel ${table} tidak dibuat oleh migration`,
          );
        }

        const migrations = await client.query(
          "SELECT name FROM pgmigrations ORDER BY id",
        );
        assert.equal(migrations.rowCount, 7);

        const emailIndex = await client.query(
          `SELECT indexdef
           FROM pg_indexes
           WHERE schemaname = 'public'
             AND tablename = 'users'
             AND indexname = 'users_email_lower_unique'`,
        );
        assert.equal(emailIndex.rowCount, 1);
        assert.match(emailIndex.rows[0].indexdef, /UNIQUE/i);
        assert.match(emailIndex.rows[0].indexdef, /lower/i);

        const cartColumns = await client.query(
          `SELECT column_name, data_type
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'cart_items'
             AND column_name IN ('user_id', 'product_id')
           ORDER BY column_name`,
        );
        assert.equal(cartColumns.rowCount, 2);

        for (const column of cartColumns.rows) {
          assert.equal(column.data_type, "bigint");
        }

        const statusColumn = await client.query(
          `SELECT is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'orders'
             AND column_name = 'status'`,
        );
        assert.equal(statusColumn.rows[0].is_nullable, "NO");
        assert.match(statusColumn.rows[0].column_default, /PENDING/);

        const roleConstraint = await client.query(
          `SELECT pg_get_constraintdef(pc.oid) AS definition
           FROM pg_constraint pc
           JOIN pg_class c ON c.oid = pc.conrelid
           WHERE c.relname = 'users' AND pc.conname = 'users_role_check'`,
        );
        assert.ok(roleConstraint.rows.length > 0);
        assert.match(roleConstraint.rows[0].definition, /admin/);
      } finally {
        await client.end();
      }
    } finally {
      await dropDatabase(baseUrl, databaseName);
    }
  },
);
