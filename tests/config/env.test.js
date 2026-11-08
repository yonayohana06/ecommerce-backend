const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { validateEnv } = require("../../src/config/env");

const validEnv = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
  JWT_SECRET: "user-secret",
  ADMIN_JWT_SECRET: "admin-secret",
  PAYMENT_SERVER_KEY: "payment-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

test("validateEnv menerima konfigurasi lengkap", () => {
  assert.doesNotThrow(() => validateEnv(validEnv));
});

test("validateEnv menolak secret wajib yang kosong", () => {
  assert.throws(
    () => validateEnv({ ...validEnv, JWT_SECRET: "  " }),
    /JWT_SECRET/,
  );
  assert.throws(
    () => validateEnv({ ...validEnv, ADMIN_JWT_SECRET: undefined }),
    /ADMIN_JWT_SECRET/,
  );
});

test("validateEnv menolak JWT_SECRET dan ADMIN_JWT_SECRET yang sama", () => {
  assert.throws(
    () => validateEnv({ ...validEnv, ADMIN_JWT_SECRET: "user-secret" }),
    /harus berbeda/,
  );
});

test("validateEnv mewajibkan DATABASE_URL atau konfigurasi DB_*", () => {
  const withoutDatabase = { ...validEnv };
  delete withoutDatabase.DATABASE_URL;

  assert.throws(() => validateEnv(withoutDatabase), /DATABASE_URL/);

  assert.doesNotThrow(() =>
    validateEnv({
      ...withoutDatabase,
      DB_HOST: "localhost",
      DB_NAME: "fastshop",
      DB_USER: "postgres",
    }),
  );
});

test("impor aplikasi gagal jika secret wajib tidak diset", () => {
  const result = spawnSync(process.execPath, ["-e", "require('./src/app')"], {
    cwd: path.resolve(__dirname, "../.."),
    env: {
      ...process.env,
      JWT_SECRET: "",
      ADMIN_JWT_SECRET: "",
      PAYMENT_SERVER_KEY: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Environment variable wajib belum diset/);
});
