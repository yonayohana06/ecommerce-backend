process.env.RATE_LIMIT_PASSWORD_MAX = "100";
process.env.RATE_LIMIT_LOGIN_MAX = "100";
process.env.RATE_LIMIT_REGISTER_MAX = "100";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  runDbTests,
  startTestServer,
  request,
  registerUser,
  loginUser,
  createAdmin,
  loginAdmin,
  getCookieValue,
  uniqueSuffix,
  cleanup,
  db,
} = require("../helpers/api");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);
const ORIGIN = "http://localhost:5173";
const CURRENT_PASSWORD = "Password123!";
const NEW_PASSWORD = "NewPassword456!";

let closeServer;
let baseUrl;
const userIds = [];

const registerTrackedUser = async () => {
  const registered = await registerUser(baseUrl, {
    email: `password-change-${uniqueSuffix()}@example.com`,
    password: CURRENT_PASSWORD,
  });
  assert.equal(registered.response.status, 201);

  userIds.push(registered.response.body.data.id);

  return registered;
};

const changeUserPassword = (token, body) =>
  request(baseUrl, "/api/auth/password", {
    method: "PUT",
    token,
    body,
  });

const changeAdminPassword = (token, body) =>
  request(baseUrl, "/api/admin/auth/password", {
    method: "PUT",
    token,
    body,
  });

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

  if (userIds.length > 0) {
    await cleanup({ userIds });
  }

  await db.pool.end();
});

dbTest("ganti password user menolak password saat ini yang salah", async () => {
  const registered = await registerTrackedUser();
  const login = await loginUser(baseUrl, registered.credentials);

  const response = await changeUserPassword(login.body.data.token, {
    current_password: "WrongPassword123!",
    new_password: NEW_PASSWORD,
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Password saat ini tidak valid.");
});

dbTest("ganti password user menolak password baru yang sama", async () => {
  const registered = await registerTrackedUser();
  const login = await loginUser(baseUrl, registered.credentials);

  const response = await changeUserPassword(login.body.data.token, {
    current_password: CURRENT_PASSWORD,
    new_password: CURRENT_PASSWORD,
  });

  assert.equal(response.status, 400);
  assert.equal(
    response.body.message,
    "Password baru harus berbeda dari password saat ini.",
  );
});

dbTest("ganti password user memvalidasi aturan password baru", async () => {
  const registered = await registerTrackedUser();
  const login = await loginUser(baseUrl, registered.credentials);
  const token = login.body.data.token;

  const cases = [
    { new_password: "Ab1", pattern: /minimal 8 karakter/i },
    { new_password: "abcdefgh", pattern: /huruf dan angka/i },
    {
      new_password: `A1${"a".repeat(72)}`,
      pattern: /maksimal 72 byte/i,
    },
  ];

  for (const item of cases) {
    const response = await changeUserPassword(token, {
      current_password: CURRENT_PASSWORD,
      new_password: item.new_password,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /new_password/);
    assert.match(response.body.message, item.pattern);
  }
});

dbTest("ganti password user mencabut semua sesi", async () => {
  const registered = await registerTrackedUser();
  const userId = registered.response.body.data.id;

  const firstLogin = await loginUser(baseUrl, registered.credentials);
  const secondLogin = await loginUser(baseUrl, registered.credentials);

  assert.equal(firstLogin.status, 200);
  assert.equal(secondLogin.status, 200);

  const firstCookie = getCookieValue(firstLogin, "fastshop_user_refresh");
  const secondCookie = getCookieValue(secondLogin, "fastshop_user_refresh");
  assert.ok(firstCookie);
  assert.ok(secondCookie);
  assert.notEqual(firstCookie, secondCookie);

  const before = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  assert.equal(before.rows[0].count, 2);

  const response = await changeUserPassword(firstLogin.body.data.token, {
    current_password: CURRENT_PASSWORD,
    new_password: NEW_PASSWORD,
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.body.message,
    "Password berhasil diubah. Silakan login ulang.",
  );

  const cookieHeader = response.setCookie.find((item) =>
    item.startsWith("fastshop_user_refresh="),
  );
  assert.ok(cookieHeader);
  assert.match(cookieHeader, /Expires=Thu, 01 Jan 1970/i);

  const active = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  assert.equal(active.rows[0].count, 0);

  const all = await db.query(
    "SELECT revoked_at FROM refresh_tokens WHERE user_id = $1",
    [userId],
  );
  assert.ok(all.rows.length >= 2);
  for (const row of all.rows) {
    assert.ok(row.revoked_at);
  }

  const oldAccess = await request(baseUrl, "/api/auth/me", {
    token: firstLogin.body.data.token,
  });
  assert.equal(oldAccess.status, 401);

  for (const value of [firstCookie, secondCookie]) {
    const refresh = await request(baseUrl, "/api/auth/refresh", {
      method: "POST",
      cookie: `fastshop_user_refresh=${value}`,
      origin: ORIGIN,
    });
    assert.equal(refresh.status, 401);
  }
});

dbTest(
  "ganti password user menolak login password lama dan menerima password baru",
  async () => {
    const registered = await registerTrackedUser();
    const login = await loginUser(baseUrl, registered.credentials);

    const changed = await changeUserPassword(login.body.data.token, {
      current_password: CURRENT_PASSWORD,
      new_password: NEW_PASSWORD,
    });
    assert.equal(changed.status, 200);

    const oldLogin = await loginUser(baseUrl, registered.credentials);
    assert.equal(oldLogin.status, 401);

    const newLogin = await loginUser(baseUrl, {
      email: registered.credentials.email,
      password: NEW_PASSWORD,
    });
    assert.equal(newLogin.status, 200);

    const profile = await request(baseUrl, "/api/auth/me", {
      token: newLogin.body.data.token,
    });
    assert.equal(profile.status, 200);
  },
);

dbTest("ganti password admin mencabut semua sesi admin", async () => {
  const created = await createAdmin({
    email: `password-change-admin-${uniqueSuffix()}@example.com`,
    password: CURRENT_PASSWORD,
  });
  userIds.push(created.admin.id);

  const firstLogin = await loginAdmin(baseUrl, created.credentials);
  const secondLogin = await loginAdmin(baseUrl, created.credentials);

  assert.equal(firstLogin.status, 200);
  assert.equal(secondLogin.status, 200);

  const firstCookie = getCookieValue(firstLogin, "fastshop_admin_refresh");
  const secondCookie = getCookieValue(secondLogin, "fastshop_admin_refresh");
  assert.ok(firstCookie);
  assert.ok(secondCookie);

  const response = await changeAdminPassword(firstLogin.body.data.token, {
    current_password: CURRENT_PASSWORD,
    new_password: NEW_PASSWORD,
  });

  assert.equal(response.status, 200);

  const cookieHeader = response.setCookie.find((item) =>
    item.startsWith("fastshop_admin_refresh="),
  );
  assert.ok(cookieHeader);
  assert.match(cookieHeader, /Path=\/api\/admin\/auth/i);
  assert.match(cookieHeader, /Expires=Thu, 01 Jan 1970/i);

  const active = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [created.admin.id],
  );
  assert.equal(active.rows[0].count, 0);

  const oldAccess = await request(baseUrl, "/api/admin/auth/me", {
    token: firstLogin.body.data.token,
  });
  assert.equal(oldAccess.status, 401);

  for (const value of [firstCookie, secondCookie]) {
    const refresh = await request(baseUrl, "/api/admin/auth/refresh", {
      method: "POST",
      cookie: `fastshop_admin_refresh=${value}`,
      origin: ORIGIN,
    });
    assert.equal(refresh.status, 401);
  }

  const oldLogin = await loginAdmin(baseUrl, created.credentials);
  assert.equal(oldLogin.status, 401);

  const newLogin = await loginAdmin(baseUrl, {
    email: created.credentials.email,
    password: NEW_PASSWORD,
  });
  assert.equal(newLogin.status, 200);
});

dbTest("ganti password membutuhkan access token", async () => {
  const response = await request(baseUrl, "/api/auth/password", {
    method: "PUT",
    body: {
      current_password: CURRENT_PASSWORD,
      new_password: NEW_PASSWORD,
    },
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.code, 401);
});
