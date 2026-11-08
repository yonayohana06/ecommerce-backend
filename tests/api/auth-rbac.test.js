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
  cleanup,
  db,
} = require("../helpers/api");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);

let closeServer;
let baseUrl;
let user;
let userCredentials;
let userToken;
let admin;
let adminCredentials;
let adminToken;

before(async () => {
  if (!runDbTests) return;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;

  const registered = await registerUser(baseUrl);
  assert.equal(registered.response.status, 201);
  user = registered.response.body.data;
  userCredentials = registered.credentials;

  const userLogin = await loginUser(baseUrl, userCredentials);
  assert.equal(userLogin.status, 200);
  userToken = userLogin.body.data.token;

  const createdAdmin = await createAdmin();
  admin = createdAdmin.admin;
  adminCredentials = createdAdmin.credentials;

  const adminLogin = await loginAdmin(baseUrl, adminCredentials);
  assert.equal(adminLogin.status, 200);
  adminToken = adminLogin.body.data.token;
});

after(async () => {
  if (!runDbTests) return;

  const userIds = [user?.id, admin?.id].filter(Boolean);

  if (userIds.length > 0) {
    await cleanup({ userIds });
  }

  if (closeServer) {
    await closeServer();
  }

  await db.pool.end();
});

dbTest("registrasi user mengembalikan role user tanpa password", () => {
  assert.ok(user.id);
  assert.equal(user.role, "user");
  assert.equal(Object.hasOwn(user, "password"), false);
});

dbTest("registrasi email duplikat ditolak 400", async () => {
  const response = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Duplikat",
      email: userCredentials.email,
      password: "Password123!",
    },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /sudah terdaftar/i);
});

dbTest("registrasi tanpa field wajib ditolak 400 JSON", async () => {
  const response = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: { email: "tanpa-nama@example.com" },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, 400);
  assert.match(response.body.message, /wajib diisi/i);
});

dbTest("registrasi password terlalu pendek ditolak 400", async () => {
  const response = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Pendek",
      email: "password-pendek@example.com",
      password: "12345",
    },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /minimal 6 karakter/i);
});

dbTest("login user dengan password salah ditolak 401", async () => {
  const response = await loginUser(baseUrl, {
    email: userCredentials.email,
    password: "PasswordSalah123!",
  });

  assert.equal(response.status, 401);
  assert.match(response.body.message, /kredensial tidak valid/i);
});

dbTest("admin tidak bisa login lewat portal user", async () => {
  const response = await loginUser(baseUrl, adminCredentials);

  assert.equal(response.status, 403);
  assert.match(response.body.message, /portal admin/i);
});

dbTest("user tidak bisa login lewat portal admin", async () => {
  const response = await loginAdmin(baseUrl, userCredentials);

  assert.equal(response.status, 403);
  assert.match(response.body.message, /hak akses administrator/i);
});

dbTest("profil user dapat diambil dengan token user", async () => {
  const response = await request(baseUrl, "/api/auth/me", { token: userToken });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.email, userCredentials.email);
  assert.equal(response.body.data.role, "user");
});

dbTest("profil admin dapat diambil dengan token admin", async () => {
  const response = await request(baseUrl, "/api/admin/auth/me", {
    token: adminToken,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.email, adminCredentials.email);
  assert.equal(response.body.data.role, "admin");
});

dbTest("endpoint admin menolak request tanpa token", async () => {
  const response = await request(baseUrl, "/api/admin/products");

  assert.equal(response.status, 401);
  assert.equal(response.body.code, 401);
});

dbTest("endpoint admin menolak token dengan role user", async () => {
  const userRoleToken = signToken(
    { userId: user.id, email: userCredentials.email, role: "user" },
    process.env.ADMIN_JWT_SECRET,
  );

  const response = await request(baseUrl, "/api/admin/products", {
    token: userRoleToken,
  });

  assert.equal(response.status, 403);
  assert.match(response.body.message, /hak akses administrator/i);
});

dbTest("endpoint user menolak token dengan role admin", async () => {
  const adminRoleToken = signToken(
    { userId: admin.id, email: adminCredentials.email, role: "admin" },
    process.env.JWT_SECRET,
  );

  const response = await request(baseUrl, "/api/cart", {
    token: adminRoleToken,
  });

  assert.equal(response.status, 403);
  assert.match(response.body.message, /administrator tidak diperbolehkan/i);
});

dbTest("endpoint user menolak request tanpa token", async () => {
  const response = await request(baseUrl, "/api/cart");

  assert.equal(response.status, 401);
  assert.equal(response.body.code, 401);
});
