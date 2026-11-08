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

test("response selalu memiliki header X-Request-Id", async () => {
  const response = await request(baseUrl, "/health");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
});

test("X-Request-Id dari client dipakai kembali", async () => {
  const response = await request(baseUrl, "/health", {
    headers: { "X-Request-Id": "client-trace-123" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), "client-trace-123");
});

test("X-Request-Id yang tidak valid diganti ID baru", async () => {
  const response = await request(baseUrl, "/health", {
    headers: { "X-Request-Id": "id dengan spasi" },
  });

  assert.equal(response.status, 200);
  const requestId = response.headers.get("x-request-id");
  assert.notEqual(requestId, "id dengan spasi");
  assert.match(requestId, /^[0-9a-f-]{36}$/);
});

test("route 404 tetap memiliki X-Request-Id", async () => {
  const response = await request(baseUrl, "/api/tidak-ada", {
    headers: { "X-Request-Id": "trace-404" },
  });

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-request-id"), "trace-404");
  assert.equal(response.body.code, 404);
});
