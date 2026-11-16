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
  createCategory,
  createProduct,
  createOrderWithItems,
  cleanup,
  db,
} = require("../helpers/api");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let closeServer;
let baseUrl;
let user;
let admin;
let adminToken;
let userToken;

const productIds = [];
const categoryIds = [];
const userIds = [];

const getAuditLogs = (query = "") =>
  request(baseUrl, `/api/admin/audit-logs${query}`, { token: adminToken });

const findLog = (logs, action, entityId) =>
  logs.find(
    (log) => log.action === action && String(log.entity_id) === String(entityId),
  );

before(async () => {
  if (!runDbTests) return;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;

  const registered = await registerUser(baseUrl);
  assert.equal(registered.response.status, 201);
  user = registered.response.body.data;
  userIds.push(user.id);

  const userLogin = await loginUser(baseUrl, registered.credentials);
  assert.equal(userLogin.status, 200);
  userToken = userLogin.body.data.token;

  const createdAdmin = await createAdmin();
  admin = createdAdmin.admin;
  userIds.push(admin.id);

  const adminLogin = await loginAdmin(baseUrl, createdAdmin.credentials);
  assert.equal(adminLogin.status, 200);
  adminToken = adminLogin.body.data.token;
});

after(async () => {
  if (!runDbTests) return;

  if (userIds.length > 0) {
    await db.query("DELETE FROM audit_logs WHERE actor_id = ANY($1::bigint[])", [
      userIds,
    ]);
  }

  await cleanup({ userIds, productIds, categoryIds });

  if (closeServer) {
    await closeServer();
  }

  await db.pool.end();
});

dbTest("admin create product mencatat audit log product.create", async () => {
  const name = `Produk Audit ${suffix}`;

  const response = await request(baseUrl, "/api/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name, price: 15000, stock: 5 },
  });

  assert.equal(response.status, 201);
  productIds.push(response.body.data.id);

  const logs = await getAuditLogs("?action=product.create&limit=100");
  assert.equal(logs.status, 200);

  const log = findLog(logs.body.data, "product.create", response.body.data.id);
  assert.ok(log, "audit log product.create harus ada");
  assert.equal(log.actor_email, admin.email);
  assert.equal(log.entity_type, "product");
  assert.equal(log.after_data.name, name);
});

dbTest("admin update product mencatat before dan after", async () => {
  const product = await createProduct({ price: 10000 });
  productIds.push(product.id);
  const newName = `${product.name} Baru`;

  const response = await request(baseUrl, `/api/admin/products/${product.id}`, {
    method: "PUT",
    token: adminToken,
    body: { name: newName },
  });

  assert.equal(response.status, 200);

  const logs = await getAuditLogs("?action=product.update&limit=100");
  const log = findLog(logs.body.data, "product.update", product.id);

  assert.ok(log, "audit log product.update harus ada");
  assert.equal(log.before_data.name, product.name);
  assert.equal(log.after_data.name, newName);
});

dbTest("admin delete product mencatat audit log product.delete", async () => {
  const product = await createProduct();

  const response = await request(baseUrl, `/api/admin/products/${product.id}`, {
    method: "DELETE",
    token: adminToken,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.delete_type, "hard_deleted");

  const logs = await getAuditLogs("?action=product.delete&limit=100");
  const log = findLog(logs.body.data, "product.delete", product.id);

  assert.ok(log, "audit log product.delete harus ada");
  assert.equal(log.before_data.name, product.name);
  assert.equal(log.after_data.delete_type, "hard_deleted");
});

dbTest("admin create category mencatat audit log category.create", async () => {
  const name = `Kategori Audit ${suffix}`;

  const response = await request(baseUrl, "/api/admin/categories", {
    method: "POST",
    token: adminToken,
    body: { name },
  });

  assert.equal(response.status, 201);
  categoryIds.push(response.body.data.id);

  const logs = await getAuditLogs("?action=category.create&limit=100");
  const log = findLog(logs.body.data, "category.create", response.body.data.id);

  assert.ok(log, "audit log category.create harus ada");
  assert.equal(log.entity_type, "category");
  assert.equal(log.after_data.name, name);
});

dbTest("admin update category mencatat before dan after", async () => {
  const category = await createCategory();
  categoryIds.push(category.id);
  const newName = `${category.name} Baru`;

  const response = await request(
    baseUrl,
    `/api/admin/categories/${category.id}`,
    {
      method: "PUT",
      token: adminToken,
      body: { name: newName },
    },
  );

  assert.equal(response.status, 200);

  const logs = await getAuditLogs("?action=category.update&limit=100");
  const log = findLog(logs.body.data, "category.update", category.id);

  assert.ok(log, "audit log category.update harus ada");
  assert.equal(log.before_data.name, category.name);
  assert.equal(log.after_data.name, newName);
});

dbTest("admin delete category mencatat audit log category.delete", async () => {
  const category = await createCategory();

  const response = await request(
    baseUrl,
    `/api/admin/categories/${category.id}`,
    { method: "DELETE", token: adminToken },
  );

  assert.equal(response.status, 200);

  const logs = await getAuditLogs("?action=category.delete&limit=100");
  const log = findLog(logs.body.data, "category.delete", category.id);

  assert.ok(log, "audit log category.delete harus ada");
  assert.equal(log.before_data.name, category.name);
});

dbTest("admin mengubah status order mencatat audit log", async () => {
  const product = await createProduct({ stock: 5 });
  productIds.push(product.id);

  const order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    quantity: 1,
    price: 10000,
    status: "PENDING",
  });

  const response = await request(
    baseUrl,
    `/api/admin/orders/${order.id}/status`,
    {
      method: "PATCH",
      token: adminToken,
      body: { status: "PAID" },
    },
  );

  assert.equal(response.status, 200);

  const logs = await getAuditLogs("?action=order.status.update&limit=100");
  const log = findLog(logs.body.data, "order.status.update", order.id);

  assert.ok(log, "audit log order.status.update harus ada");
  assert.equal(log.before_data.status, "PENDING");
  assert.equal(log.after_data.status, "PAID");
});

dbTest("GET audit-logs mengembalikan data dan pagination", async () => {
  const response = await getAuditLogs("?page=1&limit=2");

  assert.equal(response.status, 200);
  assert.equal(response.body.code, 200);
  assert.ok(Array.isArray(response.body.data));
  assert.ok(response.body.data.length <= 2);
  assert.equal(typeof response.body.pagination.currentPage, "number");
  assert.equal(typeof response.body.pagination.totalItems, "number");
  assert.equal(typeof response.body.pagination.totalPages, "number");
  assert.equal(typeof response.body.pagination.hasNextPage, "boolean");
});

dbTest("GET audit-logs dapat difilter entity_type dan action", async () => {
  const category = await createCategory();
  categoryIds.push(category.id);

  await request(baseUrl, `/api/admin/categories/${category.id}`, {
    method: "PUT",
    token: adminToken,
    body: { name: `${category.name} Filter` },
  });

  const response = await getAuditLogs(
    "?entity_type=category&action=category.update&limit=100",
  );

  assert.equal(response.status, 200);
  assert.ok(response.body.data.length >= 1);
  for (const log of response.body.data) {
    assert.equal(log.entity_type, "category");
    assert.equal(log.action, "category.update");
  }
});

dbTest("GET audit-logs menolak user token dan tanpa token", async () => {
  const withUserToken = await request(baseUrl, "/api/admin/audit-logs", {
    token: userToken,
  });
  assert.equal(withUserToken.status, 401);

  const withoutToken = await request(baseUrl, "/api/admin/audit-logs");
  assert.equal(withoutToken.status, 401);
});
