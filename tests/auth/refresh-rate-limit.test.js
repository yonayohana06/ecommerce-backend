process.env.RATE_LIMIT_REFRESH_MAX = "2";
process.env.RATE_LIMIT_REFRESH_WINDOW_MS = "60000";
process.env.RATE_LIMIT_LOGIN_MAX = "100";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  runDbTests,
  startTestServer,
  request,
  registerUser,
  loginUser,
  getCookieValue,
  cleanup,
  db,
} = require("../helpers/api");

const ORIGIN = "http://localhost:5173";

let closeServer;
let baseUrl;
let user;
let userCredentials;
let refreshCookie;

before(async () => {
  if (!runDbTests) return;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;

  const registered = await registerUser(baseUrl, {
    email: `refresh-limit-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}@example.com`,
    password: "Password123!",
  });
  assert.equal(registered.response.status, 201);
  user = registered.response.body.data;
  userCredentials = registered.credentials;

  const login = await loginUser(baseUrl, userCredentials);
  assert.equal(login.status, 200);
  refreshCookie = getCookieValue(login, "fastshop_user_refresh");
});

after(async () => {
  if (!runDbTests) return;

  if (closeServer) {
    await closeServer();
  }

  if (user) {
    await cleanup({ userIds: [user.id] });
  }

  await db.pool.end();
});

test(
  "refresh mengembalikan 429 setelah batas rate limit tercapai",
  { skip: !runDbTests },
  async () => {
    const send = (cookie) =>
      request(baseUrl, "/api/auth/refresh", {
        method: "POST",
        cookie,
        origin: ORIGIN,
      });

    const first = await send(`fastshop_user_refresh=${refreshCookie}`);
    assert.equal(first.status, 200);
    refreshCookie = getCookieValue(first, "fastshop_user_refresh");

    const second = await send(`fastshop_user_refresh=${refreshCookie}`);
    assert.equal(second.status, 200);
    refreshCookie = getCookieValue(second, "fastshop_user_refresh");

    const third = await send(`fastshop_user_refresh=${refreshCookie}`);

    assert.equal(third.status, 429);
    assert.equal(third.body.code, 429);
    assert.match(third.body.message, /terlalu banyak/i);
    assert.ok(Number(third.headers.get("retry-after")) > 0);
  },
);
