const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { startTestServer, request, db } = require("../helpers/api");

let closeServer;
let baseUrl;

before(async () => {
  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;
});

after(async () => {
  if (closeServer) {
    await closeServer();
  }

  await db.pool.end();
});

test("GET /health mengembalikan 200 tanpa menyentuh database", async () => {
  const response = await request(baseUrl, "/health");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok" });
});

test("GET /200 tetap kompatibel sebagai alias health check", async () => {
  const response = await request(baseUrl, "/200");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok" });
});

test("GET /ready mengembalikan 200 saat database siap", async () => {
  const originalQuery = db.query;
  db.query = async () => ({ rows: [{ "?column?": 1 }] });

  try {
    const response = await request(baseUrl, "/ready");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "ready" });
  } finally {
    db.query = originalQuery;
  }
});

test("GET /ready mengembalikan 503 saat database gagal", async () => {
  const originalQuery = db.query;
  db.query = async () => {
    throw new Error("database down");
  };

  try {
    const response = await request(baseUrl, "/ready");

    assert.equal(response.status, 503);
    assert.equal(response.body.code, 503);
    assert.match(response.body.message, /belum siap/i);
  } finally {
    db.query = originalQuery;
  }
});
