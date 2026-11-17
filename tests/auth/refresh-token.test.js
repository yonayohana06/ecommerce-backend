process.env.RATE_LIMIT_LOGIN_MAX = "100";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const {
  runDbTests,
  startTestServer,
  request,
  loginUser,
  loginAdmin,
  registerUser,
  createAdmin,
  getCookieValue,
  cleanup,
  db,
} = require("../helpers/api");
const { hashRefreshToken } = require("../../src/services/authTokenService");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);
const ORIGIN = "http://localhost:5173";
const userCookie = (value) => `fastshop_user_refresh=${value}`;
const adminCookie = (value) => `fastshop_admin_refresh=${value}`;

let closeServer;
let baseUrl;
let user;
let admin;
let userCredentials;
let adminCredentials;

before(async () => {
  if (!runDbTests) return;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;

  const registered = await registerUser(baseUrl, {
    email: `refresh-login-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}@example.com`,
    password: "Password123!",
  });
  assert.equal(registered.response.status, 201);
  user = registered.response.body.data;
  userCredentials = registered.credentials;

  const created = await createAdmin();
  admin = created.admin;
  adminCredentials = created.credentials;
});

after(async () => {
  if (!runDbTests) return;

  if (closeServer) {
    await closeServer();
  }

  if (user || admin) {
    await cleanup({
      userIds: [user?.id, admin?.id].filter(Boolean),
    });
  }

  await db.pool.end();
});

dbTest(
  "login user menetapkan cookie refresh HttpOnly tanpa refresh token di body",
  async () => {
    const response = await loginUser(baseUrl, userCredentials);

    assert.equal(response.status, 200);
    assert.ok(response.body.data.token);
    assert.equal(Object.hasOwn(response.body.data, "refreshToken"), false);
    assert.equal(Object.hasOwn(response.body.data, "refresh_token"), false);

    const cookie = response.setCookie.find((item) =>
      item.startsWith("fastshop_user_refresh="),
    );
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Path=\/api\/auth/i);
    assert.match(cookie, /SameSite=Lax/i);
  },
);

dbTest("login admin menetapkan cookie admin tanpa refresh token di body", async () => {
  const response = await loginAdmin(baseUrl, adminCredentials);

  assert.equal(response.status, 200);
  assert.ok(response.body.data.token);
  assert.equal(Object.hasOwn(response.body.data, "refreshToken"), false);
  assert.equal(Object.hasOwn(response.body.data, "refresh_token"), false);

  const cookie = response.setCookie.find((item) =>
    item.startsWith("fastshop_admin_refresh="),
  );
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Path=\/api\/admin\/auth/i);
  assert.match(cookie, /SameSite=Lax/i);
});

dbTest("access token login memuat tokenVersion", async () => {
  const response = await loginUser(baseUrl, userCredentials);
  const decoded = jwt.decode(response.body.data.token);

  assert.equal(decoded.tokenVersion, 1);
  assert.equal(decoded.type, "user");
  assert.equal(String(decoded.userId), String(user.id));
});

dbTest("access token login admin memuat tokenVersion", async () => {
  const response = await loginAdmin(baseUrl, adminCredentials);
  const decoded = jwt.decode(response.body.data.token);

  assert.equal(decoded.tokenVersion, 1);
  assert.equal(decoded.type, "admin");
  assert.equal(String(decoded.userId), String(admin.id));
});

dbTest("cookie refresh disimpan sebagai hash di database", async () => {
  const login = await loginUser(baseUrl, userCredentials);
  const raw = getCookieValue(login, "fastshop_user_refresh");

  assert.ok(raw);

  const row = await db.query(
    `SELECT token_hash, portal, token_version
     FROM refresh_tokens
     WHERE user_id = $1 AND token_hash = $2`,
    [user.id, hashRefreshToken(raw)],
  );

  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0].token_hash, hashRefreshToken(raw));
  assert.notEqual(row.rows[0].token_hash, raw);
  assert.equal(row.rows[0].portal, "user");
  assert.equal(row.rows[0].token_version, 1);
});

dbTest("cookie refresh admin disimpan sebagai hash portal admin", async () => {
  const login = await loginAdmin(baseUrl, adminCredentials);
  const raw = getCookieValue(login, "fastshop_admin_refresh");

  assert.ok(raw);

  const row = await db.query(
    `SELECT portal, token_version
     FROM refresh_tokens
     WHERE user_id = $1 AND token_hash = $2`,
    [admin.id, hashRefreshToken(raw)],
  );

  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0].portal, "admin");
  assert.equal(row.rows[0].token_version, 1);
});

const refreshUser = (cookie, origin = ORIGIN) =>
  request(baseUrl, "/api/auth/refresh", {
    method: "POST",
    cookie,
    origin,
  });

const refreshAdmin = (cookie, origin = ORIGIN) =>
  request(baseUrl, "/api/admin/auth/refresh", {
    method: "POST",
    cookie,
    origin,
  });

const logoutUser = (cookie, origin = ORIGIN) =>
  request(baseUrl, "/api/auth/logout", {
    method: "POST",
    cookie,
    origin,
  });

const logoutAdmin = (cookie, origin = ORIGIN) =>
  request(baseUrl, "/api/admin/auth/logout", {
    method: "POST",
    cookie,
    origin,
  });

dbTest("refresh user merotasi cookie dan access token", async () => {
  const login = await loginUser(baseUrl, userCredentials);
  const oldToken = getCookieValue(login, "fastshop_user_refresh");

  assert.ok(oldToken);

  const response = await refreshUser(userCookie(oldToken));

  assert.equal(response.status, 200);
  assert.ok(response.body.data.token);
  assert.equal(Object.hasOwn(response.body.data, "refreshToken"), false);

  const newToken = getCookieValue(response, "fastshop_user_refresh");
  assert.ok(newToken);
  assert.notEqual(newToken, oldToken);

  const cookieHeader = response.setCookie.find((item) =>
    item.startsWith("fastshop_user_refresh="),
  );
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /Path=\/api\/auth/i);

  const profile = await request(baseUrl, "/api/auth/me", {
    token: response.body.data.token,
  });
  assert.equal(profile.status, 200);

  const oldRow = await db.query(
    "SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1",
    [hashRefreshToken(oldToken)],
  );
  assert.ok(oldRow.rows[0].revoked_at);
});

dbTest("refresh user menolak token lama setelah rotasi", async () => {
  const login = await loginUser(baseUrl, userCredentials);
  const oldToken = getCookieValue(login, "fastshop_user_refresh");

  const first = await refreshUser(userCookie(oldToken));
  assert.equal(first.status, 200);

  const second = await refreshUser(userCookie(oldToken));

  assert.equal(second.status, 401);
  assert.equal(second.body.code, 401);
});

dbTest("replay refresh token lama mencabut seluruh family", async () => {
  const login = await loginUser(baseUrl, userCredentials);
  const firstToken = getCookieValue(login, "fastshop_user_refresh");

  const rotated = await refreshUser(userCookie(firstToken));
  assert.equal(rotated.status, 200);
  const secondToken = getCookieValue(rotated, "fastshop_user_refresh");

  const replay = await refreshUser(userCookie(firstToken));
  assert.equal(replay.status, 401);

  const afterReplay = await refreshUser(userCookie(secondToken));
  assert.equal(afterReplay.status, 401);

  const firstRow = await db.query(
    "SELECT family_id FROM refresh_tokens WHERE token_hash = $1",
    [hashRefreshToken(firstToken)],
  );
  const family = await db.query(
    "SELECT revoked_at FROM refresh_tokens WHERE family_id = $1",
    [firstRow.rows[0].family_id],
  );

  assert.ok(family.rows.length >= 2);
  for (const row of family.rows) {
    assert.ok(row.revoked_at, "semua token family harus dicabut");
  }
});

dbTest("refresh tanpa cookie ditolak 401", async () => {
  const response = await refreshUser(undefined);

  assert.equal(response.status, 401);
  assert.equal(response.body.code, 401);
});

dbTest("refresh menolak origin yang tidak diizinkan", async () => {
  const login = await loginUser(baseUrl, userCredentials);
  const token = getCookieValue(login, "fastshop_user_refresh");

  const missingOrigin = await request(baseUrl, "/api/auth/refresh", {
    method: "POST",
    cookie: userCookie(token),
  });
  const evilOrigin = await refreshUser(
    userCookie(token),
    "https://evil.example",
  );
  const allowedOrigin = await refreshUser(userCookie(token));

  assert.equal(missingOrigin.status, 403);
  assert.equal(evilOrigin.status, 403);
  assert.equal(allowedOrigin.status, 200);
});

dbTest("refresh token kedaluwarsa 401 dan cookie dibersihkan", async () => {
  const login = await loginUser(baseUrl, userCredentials);
  const token = getCookieValue(login, "fastshop_user_refresh");

  await db.query(
    `UPDATE refresh_tokens
     SET expires_at = NOW() - INTERVAL '1 second'
     WHERE token_hash = $1`,
    [hashRefreshToken(token)],
  );

  const response = await refreshUser(userCookie(token));

  assert.equal(response.status, 401);
  const cookieHeader = response.setCookie.find((item) =>
    item.startsWith("fastshop_user_refresh="),
  );
  assert.ok(cookieHeader);
  assert.match(cookieHeader, /Expires=Thu, 01 Jan 1970/i);
});

dbTest("refresh admin memakai cookie admin", async () => {
  const login = await loginAdmin(baseUrl, adminCredentials);
  const oldToken = getCookieValue(login, "fastshop_admin_refresh");

  const response = await refreshAdmin(adminCookie(oldToken));

  assert.equal(response.status, 200);
  const newToken = getCookieValue(response, "fastshop_admin_refresh");
  assert.ok(newToken);
  assert.notEqual(newToken, oldToken);

  const profile = await request(baseUrl, "/api/admin/auth/me", {
    token: response.body.data.token,
  });
  assert.equal(profile.status, 200);
});

dbTest("refresh menolak cookie portal lain", async () => {
  const userLogin = await loginUser(baseUrl, userCredentials);
  const userToken = getCookieValue(userLogin, "fastshop_user_refresh");

  const adminLogin = await loginAdmin(baseUrl, adminCredentials);
  const adminToken = getCookieValue(adminLogin, "fastshop_admin_refresh");

  const userOnAdmin = await refreshAdmin(userCookie(userToken));
  const adminOnUser = await refreshUser(adminCookie(adminToken));

  assert.equal(userOnAdmin.status, 401);
  assert.equal(adminOnUser.status, 401);
});

dbTest(
  "logout user mencabut refresh token dan menghapus cookie",
  async () => {
    const login = await loginUser(baseUrl, userCredentials);
    const token = getCookieValue(login, "fastshop_user_refresh");

    const response = await logoutUser(userCookie(token));

    assert.equal(response.status, 200);
    assert.equal(response.body.message, "Logout berhasil");

    const cookieHeader = response.setCookie.find((item) =>
      item.startsWith("fastshop_user_refresh="),
    );
    assert.ok(cookieHeader);
    assert.match(cookieHeader, /Expires=Thu, 01 Jan 1970/i);

    const refresh = await refreshUser(userCookie(token));
    assert.equal(refresh.status, 401);

    const row = await db.query(
      "SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1",
      [hashRefreshToken(token)],
    );
    assert.ok(row.rows[0].revoked_at);
  },
);

dbTest("logout idempoten tanpa cookie", async () => {
  const first = await logoutUser(undefined);
  const second = await logoutUser(undefined);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.code, 200);
  assert.equal(second.body.code, 200);
});

dbTest("logout dengan origin asing ditolak 403", async () => {
  const login = await loginUser(baseUrl, userCredentials);
  const token = getCookieValue(login, "fastshop_user_refresh");

  const response = await logoutUser(userCookie(token), "https://evil.example");

  assert.equal(response.status, 403);
  assert.equal(response.body.code, 403);

  const stillActive = await refreshUser(userCookie(token));
  assert.equal(stillActive.status, 200);
});

dbTest("logout admin mencabut sesi admin", async () => {
  const login = await loginAdmin(baseUrl, adminCredentials);
  const token = getCookieValue(login, "fastshop_admin_refresh");

  const response = await logoutAdmin(adminCookie(token));

  assert.equal(response.status, 200);
  const cookieHeader = response.setCookie.find((item) =>
    item.startsWith("fastshop_admin_refresh="),
  );
  assert.ok(cookieHeader);
  assert.match(cookieHeader, /Path=\/api\/admin\/auth/i);

  const refresh = await refreshAdmin(adminCookie(token));
  assert.equal(refresh.status, 401);
});

dbTest(
  "access token tetap berlaku sampai kedaluwarsa setelah logout",
  async () => {
    const login = await loginUser(baseUrl, userCredentials);
    const token = getCookieValue(login, "fastshop_user_refresh");

    const logout = await logoutUser(userCookie(token));
    assert.equal(logout.status, 200);

    const profile = await request(baseUrl, "/api/auth/me", {
      token: login.body.data.token,
    });
    assert.equal(profile.status, 200);
  },
);
