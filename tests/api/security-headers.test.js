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

test("response tidak membocorkan x-powered-by", async () => {
  const response = await request(baseUrl, "/api/does-not-exist");

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("response memakai header keamanan helmet", async () => {
  const response = await request(baseUrl, "/api/does-not-exist");

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(response.headers.get("content-security-policy"));
});
