process.env.RATE_LIMIT_REGISTER_MAX = "100";
process.env.RATE_LIMIT_LOGIN_MAX = "100";

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
  signToken,
  uniqueSuffix,
  cleanup,
  db,
} = require("../helpers/api");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);
const INVALID_CREDENTIALS = "Kredensial tidak valid.";

let closeServer;
let baseUrl;
let user;
let admin;

const rawEmail = `MixedCase-${uniqueSuffix()}@Example.COM`;
const normalizedEmail = rawEmail.trim().toLowerCase();

before(async () => {
  if (!runDbTests) return;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;

  const registered = await registerUser(baseUrl, {
    email: rawEmail,
    password: "Password123!",
  });
  assert.equal(registered.response.status, 201);
  user = registered.response.body.data;

  const createdAdmin = await createAdmin({ password: "Password123!" });
  admin = createdAdmin.admin;
});

after(async () => {
  if (!runDbTests) return;

  await cleanup({ userIds: [user?.id, admin?.id].filter(Boolean) });

  if (closeServer) {
    await closeServer();
  }

  await db.pool.end();
});

dbTest("registrasi menormalkan email menjadi lowercase dan trim", () => {
  assert.equal(user.email, normalizedEmail);
});

dbTest("login menerima email dengan kapitalisasi berbeda", async () => {
  const lower = await loginUser(baseUrl, {
    email: normalizedEmail,
    password: "Password123!",
  });
  assert.equal(lower.status, 200);

  const upper = await loginUser(baseUrl, {
    email: rawEmail.toUpperCase(),
    password: "Password123!",
  });
  assert.equal(upper.status, 200);
});

dbTest("registrasi email duplikat beda kapitalisasi ditolak", async () => {
  const response = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Duplikat Case",
      email: normalizedEmail,
      password: "Password123!",
    },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /sudah terdaftar/i);
});

dbTest("semua kegagalan login memakai 401 dan pesan generik", async () => {
  const adminCredentials = await createAdmin({
    email: `AdminCase-${uniqueSuffix()}@Example.COM`,
    password: "Password123!",
  });

  const failures = [
    await loginUser(baseUrl, {
      email: `tidak-ada-${uniqueSuffix()}@example.com`,
      password: "Password123!",
    }),
    await loginUser(baseUrl, {
      email: normalizedEmail,
      password: "PasswordSalah123!",
    }),
    await loginUser(baseUrl, adminCredentials.credentials),
    await loginAdmin(baseUrl, {
      email: normalizedEmail,
      password: "Password123!",
    }),
  ];

  for (const response of failures) {
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 401);
    assert.equal(response.body.message, INVALID_CREDENTIALS);
  }

  await cleanup({ userIds: [adminCredentials.admin.id] });
});

dbTest("registrasi menolak password pendek, lemah, dan lebih dari 72 byte", async () => {
  const cases = [
    { password: "Aa1", message: /minimal 8 karakter/i },
    { password: "abcdefgh", message: /huruf dan angka/i },
    { password: "12345678", message: /huruf dan angka/i },
    { password: `A1${"x".repeat(71)}`, message: /72 byte/i },
  ];

  for (const item of cases) {
    const response = await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Password Test",
        email: `password-${uniqueSuffix()}@example.com`,
        password: item.password,
      },
    });

    assert.equal(response.status, 400, `password ${item.password} seharusnya ditolak`);
    assert.match(response.body.message, item.message);
  }
});

dbTest("token user wajib memiliki role dan type user", async () => {
  const cases = [
    { userId: user.id, email: normalizedEmail, role: "user" },
    { userId: user.id, email: normalizedEmail, role: "user", type: "admin" },
    { userId: user.id, email: normalizedEmail, role: "admin", type: "user" },
  ];

  for (const payload of cases) {
    const token = signToken(payload, process.env.JWT_SECRET);
    const response = await request(baseUrl, "/api/cart", { token });

    assert.equal(response.status, 403);
    assert.equal(response.body.code, 403);
  }
});

dbTest("token admin wajib memiliki role dan type admin", async () => {
  const cases = [
    { userId: admin.id, email: admin.email, role: "admin" },
    { userId: admin.id, email: admin.email, role: "admin", type: "user" },
    { userId: admin.id, email: admin.email, role: "user", type: "admin" },
  ];

  for (const payload of cases) {
    const token = signToken(payload, process.env.ADMIN_JWT_SECRET);
    const response = await request(baseUrl, "/api/admin/products", { token });

    assert.equal(response.status, 403);
    assert.equal(response.body.code, 403);
  }
});

dbTest("token dengan secret portal lain ditolak", async () => {
  const adminPayload = { userId: admin.id, role: "admin", type: "admin" };
  const userPayload = { userId: user.id, role: "user", type: "user" };

  const adminWithUserSecret = await request(baseUrl, "/api/admin/products", {
    token: signToken(adminPayload, process.env.JWT_SECRET),
  });
  assert.equal(adminWithUserSecret.status, 401);

  const userWithAdminSecret = await request(baseUrl, "/api/cart", {
    token: signToken(userPayload, process.env.ADMIN_JWT_SECRET),
  });
  assert.equal(userWithAdminSecret.status, 401);
});

dbTest("token valid tetap dapat mengakses portal yang sesuai", async () => {
  const userLogin = await loginUser(baseUrl, {
    email: normalizedEmail,
    password: "Password123!",
  });
  assert.equal(userLogin.status, 200);

  const profile = await request(baseUrl, "/api/auth/me", {
    token: userLogin.body.data.token,
  });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.role, "user");

  const adminLogin = await loginAdmin(baseUrl, {
    email: admin.email,
    password: "Password123!",
  });
  assert.equal(adminLogin.status, 200);

  const adminProfile = await request(baseUrl, "/api/admin/auth/me", {
    token: adminLogin.body.data.token,
  });
  assert.equal(adminProfile.status, 200);
  assert.equal(adminProfile.body.data.role, "admin");
});
