const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { startTestServer, request, db } = require("../helpers/api");
const { isApiDocsEnabled } = require("../../src/docs/apiDocs");

let closeServer;
let baseUrl;

before(async () => {
  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;
});

after(async () => {
  if (closeServer) await closeServer();
  await db.pool.end();
});

test("docs hanya non-production", () => {
  assert.equal(isApiDocsEnabled({ nodeEnv: "production" }), false);
  assert.equal(isApiDocsEnabled({ nodeEnv: "development" }), true);
  assert.equal(isApiDocsEnabled({ nodeEnv: "test" }), true);
  assert.equal(isApiDocsEnabled({ nodeEnv: undefined }), true);
});

test("GET /api/docs/ menyajikan Swagger UI", async () => {
  const response = await request(baseUrl, "/api/docs/");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(response.body, /id="swagger-ui"/);
  assert.match(response.body, /swagger-ui-bundle\.js/);
});

test("GET /api/docs/openapi.json menyajikan spec", async () => {
  const response = await request(baseUrl, "/api/docs/openapi.json");

  assert.equal(response.status, 200);
  assert.equal(response.body.openapi, "3.0.3");
  assert.equal(typeof response.body.paths, "object");
});

test("GET /api/docs/openapi.yaml menyajikan sumber YAML", async () => {
  const response = await request(baseUrl, "/api/docs/openapi.yaml");

  assert.equal(response.status, 200);
  assert.match(response.body, /openapi: 3\.0\.3/);
});

test("CSP docs mengizinkan inline script tanpa duplikasi policy", async () => {
  const response = await request(baseUrl, "/api/docs/");
  const csp = response.headers.get("content-security-policy") || "";

  assert.match(csp, /script-src[^;]*'unsafe-inline'/);
  assert.equal((csp.match(/script-src/g) || []).length, 1);
});

test("CSP global tetap tidak mengizinkan inline script", async () => {
  const response = await request(baseUrl, "/health");
  const csp = response.headers.get("content-security-policy") || "";

  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
});
