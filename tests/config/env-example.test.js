const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { REQUIRED_ENV } = require("../../src/config/env");

const examplePath = path.resolve(__dirname, "../../.env.example");
const example = fs.readFileSync(examplePath, "utf8");
const keys = new Set(
  example
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0]),
);

test(".env.example memuat semua environment wajib", () => {
  for (const name of REQUIRED_ENV) {
    assert.ok(keys.has(name), `.env.example belum memuat ${name}`);
  }
});

test(".env.example memuat konfigurasi database dan test", () => {
  for (const name of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_NAME",
    "DB_POOL_MAX",
  ]) {
    assert.ok(keys.has(name), `.env.example belum memuat ${name}`);
  }
});

test(".env.example memuat konfigurasi JWT, admin seed, dan rate limit", () => {
  for (const name of [
    "JWT_SECRET",
    "JWT_EXPIRES_IN",
    "ADMIN_JWT_SECRET",
    "ADMIN_JWT_EXPIRES_IN",
    "ADMIN_NAME",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
    "ADMIN_PHONE_NUMBER",
    "RATE_LIMIT_LOGIN_MAX",
    "RATE_LIMIT_UPLOAD_MAX",
  ]) {
    assert.ok(keys.has(name), `.env.example belum memuat ${name}`);
  }
});

test(".env.example tidak berisi nilai secret asli", () => {
  assert.doesNotMatch(example, /service_role\.eyJ/);
  assert.doesNotMatch(example, /sk_live_/);
  assert.doesNotMatch(example, /postgres:\/\/postgres:[^@\s]+@db\./);
});
