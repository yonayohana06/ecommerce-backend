const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  percentile,
  summarize,
  resolveBenchmarkDatabaseUrl,
} = require("../../scripts/lib/benchmark");

test("percentile memakai nearest-rank pada data tidak terurut", () => {
  assert.equal(percentile([500, 100, 300, 200, 400], 50), 300);
  assert.equal(percentile([500, 100, 300, 200, 400], 95), 500);
  assert.equal(percentile([42], 95), 42);
});

test("percentile mengembalikan 0 untuk data kosong", () => {
  assert.equal(percentile([], 95), 0);
});

test("summarize melaporkan p50 p95 max dan status target", () => {
  assert.deepEqual(summarize([100, 150, 200, 250]), {
    count: 4,
    p50: 150,
    p95: 250,
    max: 250,
    passed: false,
  });
  assert.deepEqual(summarize([100, 120, 180]), {
    count: 3,
    p50: 120,
    p95: 180,
    max: 180,
    passed: true,
  });
});

test("resolveBenchmarkDatabaseUrl menolak target tidak aman", () => {
  assert.throws(
    () =>
      resolveBenchmarkDatabaseUrl({
        testDatabaseUrl: "postgres://test",
        databaseUrl: "postgres://main",
        nodeEnv: "production",
      }),
    /production/i,
  );
  assert.throws(
    () =>
      resolveBenchmarkDatabaseUrl({
        testDatabaseUrl: "",
        databaseUrl: "postgres://main",
        nodeEnv: "test",
      }),
    /TEST_DATABASE_URL/,
  );
  assert.throws(
    () =>
      resolveBenchmarkDatabaseUrl({
        testDatabaseUrl: "postgres://same",
        databaseUrl: "postgres://same",
        nodeEnv: "test",
      }),
    /DATABASE_URL/,
  );
});

test("resolveBenchmarkDatabaseUrl menolak URL setara yang ditulis berbeda", () => {
  const mainUrl =
    "postgres://user:pass@db.example.com:5432/app?sslmode=require";
  const equivalents = [
    "postgres://user:pass@db.example.com/app",
    "postgres://user:pass@db.example.com:5432/app/",
    "  postgres://user:pass@db.example.com/app?sslmode=disable  ",
    "postgresql://user:pass@db.example.com/app",
    "postgres://different:credentials@db.example.com/app",
  ];

  for (const testDatabaseUrl of equivalents) {
    assert.throws(
      () =>
        resolveBenchmarkDatabaseUrl({
          testDatabaseUrl,
          databaseUrl: mainUrl,
          nodeEnv: "test",
        }),
      /DATABASE_URL/,
    );
  }
});

test("resolveBenchmarkDatabaseUrl menyamakan localhost dan loopback", () => {
  assert.throws(
    () =>
      resolveBenchmarkDatabaseUrl({
        testDatabaseUrl: "postgres://127.0.0.1:5432/fastshop",
        databaseUrl: "postgres://localhost/fastshop",
        nodeEnv: "test",
      }),
    /DATABASE_URL/,
  );
});

test("resolveBenchmarkDatabaseUrl menolak production tanpa peduli kapitalisasi", () => {
  assert.throws(
    () =>
      resolveBenchmarkDatabaseUrl({
        testDatabaseUrl: "postgres://test",
        databaseUrl: "postgres://main",
        nodeEnv: " Production ",
      }),
    /production/i,
  );
});

test("resolveBenchmarkDatabaseUrl menolak URL test yang tidak valid", () => {
  assert.throws(
    () =>
      resolveBenchmarkDatabaseUrl({
        testDatabaseUrl: "bukan-url",
        databaseUrl: "postgres://main",
        nodeEnv: "test",
      }),
    /TEST_DATABASE_URL/,
  );
});

test("resolveBenchmarkDatabaseUrl mengizinkan database berbeda pada host yang sama", () => {
  assert.equal(
    resolveBenchmarkDatabaseUrl({
      testDatabaseUrl:
        "postgres://user:pass@db.example.com:5432/app_test",
      databaseUrl: "postgres://user:pass@db.example.com:5432/app",
      nodeEnv: "test",
    }),
    "postgres://user:pass@db.example.com:5432/app_test",
  );
});

test("resolveBenchmarkDatabaseUrl mengembalikan URL test yang aman", () => {
  assert.equal(
    resolveBenchmarkDatabaseUrl({
      testDatabaseUrl: "postgres://test",
      databaseUrl: "postgres://main",
      nodeEnv: "test",
    }),
    "postgres://test",
  );
});
