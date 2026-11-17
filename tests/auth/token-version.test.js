process.env.RATE_LIMIT_LOGIN_MAX = "100";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const {
  runDbTests,
  startTestServer,
  request,
  registerUser,
  loginUser,
  createAdmin,
  loginAdmin,
  signToken,
  uniqueSuffix,
  cleanup,
  db,
} = require("../helpers/api");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);

let closeServer;
let baseUrl;
const userIds = [];

const makeUser = async () => {
  const registered = await registerUser(baseUrl, {
    email: `token-version-${uniqueSuffix()}@example.com`,
    password: "Password123!",
  });
  assert.equal(registered.response.status, 201);

  const login = await loginUser(baseUrl, registered.credentials);
  assert.equal(login.status, 200);

  userIds.push(registered.response.body.data.id);

  return {
    user: registered.response.body.data,
    token: login.body.data.token,
  };
};

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

dbTest(
  "access token user ditolak setelah token_version dinaikkan",
  async () => {
    const { user, token } = await makeUser();

    await db.query(
      "UPDATE users SET token_version = token_version + 1 WHERE id = $1",
      [user.id],
    );

    const response = await request(baseUrl, "/api/auth/me", { token });

    assert.equal(response.status, 401);
    assert.equal(response.body.code, 401);
  },
);

dbTest(
  "access token admin ditolak setelah token_version dinaikkan",
  async () => {
    const created = await createAdmin({
      email: `token-version-admin-${uniqueSuffix()}@example.com`,
    });
    userIds.push(created.admin.id);

    const login = await loginAdmin(baseUrl, created.credentials);
    assert.equal(login.status, 200);

    await db.query(
      "UPDATE users SET token_version = token_version + 1 WHERE id = $1",
      [created.admin.id],
    );

    const response = await request(baseUrl, "/api/admin/auth/me", {
      token: login.body.data.token,
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.code, 401);
  },
);

dbTest("token lama tanpa klaim tokenVersion tetap diterima", async () => {
  const { user } = await makeUser();

  const legacyToken = signToken(
    {
      userId: user.id,
      email: user.email,
      role: "user",
      type: "user",
    },
    process.env.JWT_SECRET,
  );

  const decoded = jwt.decode(legacyToken);
  assert.equal(Object.hasOwn(decoded, "tokenVersion"), false);

  const response = await request(baseUrl, "/api/auth/me", {
    token: legacyToken,
  });

  assert.equal(response.status, 200);
});

dbTest("perubahan role di database membatalkan token", async () => {
  const { user, token } = await makeUser();

  await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);

  const response = await request(baseUrl, "/api/auth/me", { token });

  assert.equal(response.status, 401);
});

dbTest("token dengan tokenVersion salah ditolak", async () => {
  const { user } = await makeUser();

  const forgedToken = signToken(
    {
      userId: user.id,
      email: user.email,
      role: "user",
      type: "user",
      tokenVersion: 99,
    },
    process.env.JWT_SECRET,
  );

  const response = await request(baseUrl, "/api/auth/me", {
    token: forgedToken,
  });

  assert.equal(response.status, 401);
});

dbTest("token valid dengan versi benar tetap diterima", async () => {
  const { token } = await makeUser();

  const response = await request(baseUrl, "/api/auth/me", { token });

  assert.equal(response.status, 200);
  assert.equal(response.body.code, 200);
});
