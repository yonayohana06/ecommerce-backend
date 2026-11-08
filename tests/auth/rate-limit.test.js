process.env.RATE_LIMIT_LOGIN_MAX = "2";
process.env.RATE_LIMIT_LOGIN_WINDOW_MS = "60000";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  runDbTests,
  startTestServer,
  request,
  uniqueSuffix,
  db,
} = require("../helpers/api");

let closeServer;
let baseUrl;

before(async () => {
  if (!runDbTests) return;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;
});

after(async () => {
  if (!runDbTests) return;

  if (closeServer) {
    await closeServer();
  }

  await db.pool.end();
});

test(
  "login mengembalikan 429 setelah batas rate limit tercapai",
  { skip: !runDbTests },
  async () => {
    const body = {
      email: `rate-limit-${uniqueSuffix()}@example.com`,
      password: "Password123!",
    };

    const first = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body,
    });
    const second = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body,
    });
    const third = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body,
    });

    assert.equal(first.status, 401);
    assert.equal(second.status, 401);
    assert.equal(third.status, 429);
    assert.equal(third.body.code, 429);
    assert.match(third.body.message, /terlalu banyak/i);
    assert.ok(Number(third.headers.get("retry-after")) > 0);
  },
);
