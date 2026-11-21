const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  runDbTests,
  uniqueSuffix,
  startTestServer,
  request,
  registerUser,
  createAdmin,
  loginAdmin,
  createProduct,
  createOrderWithItems,
  cleanup,
  db,
} = require("../helpers/api");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);

let closeServer;
let baseUrl;
let adminToken;
let user;
let otherUser;
let order;
let otherOrder;
let product;
let numericToken;
const userIds = [];
const productIds = [];

const searchOrders = (search, suffix = "") =>
  request(
    baseUrl,
    `/api/admin/orders?limit=100&search=${encodeURIComponent(search)}${suffix}`,
    { token: adminToken },
  );

before(async () => {
  if (!runDbTests) return;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;

  const createdAdmin = await createAdmin();
  userIds.push(createdAdmin.admin.id);

  const login = await loginAdmin(baseUrl, createdAdmin.credentials);
  assert.equal(login.status, 200);
  adminToken = login.body.data.token;

  const suffix = uniqueSuffix();

  const registered = await registerUser(baseUrl, {
    email: `search-user-${suffix}@example.com`,
    name: `User Pencarian ${suffix}`,
  });
  assert.equal(registered.response.status, 201);
  user = registered.response.body.data;
  userIds.push(user.id);

  const registeredOther = await registerUser(baseUrl, {
    email: `search-other-${suffix}@example.com`,
    name: "User Lain",
  });
  assert.equal(registeredOther.response.status, 201);
  otherUser = registeredOther.response.body.data;
  userIds.push(otherUser.id);

  numericToken = `9${Date.now()}555`;
  const registeredNumeric = await registerUser(baseUrl, {
    email: `${numericToken}@example.com`,
    name: "User Numeric",
  });
  assert.equal(registeredNumeric.response.status, 201);
  userIds.push(registeredNumeric.response.body.data.id);

  product = await createProduct();
  productIds.push(product.id);

  order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    status: "PENDING",
  });
  otherOrder = await createOrderWithItems({
    userId: otherUser.id,
    productId: product.id,
    status: "PAID",
  });
  await createOrderWithItems({
    userId: registeredNumeric.response.body.data.id,
    productId: product.id,
  });
});

after(async () => {
  if (!runDbTests) return;

  await cleanup({ userIds, productIds });

  if (closeServer) {
    await closeServer();
  }

  await db.pool.end();
});

dbTest("search angka mencocokkan ID pesanan secara exact", async () => {
  const response = await searchOrders(order.id);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(String(response.body.data[0].order_id), String(order.id));
  assert.equal(response.body.pagination.totalItems, 1);
});

dbTest("search angka dengan leading zero tetap cocok dengan ID", async () => {
  const padded = String(order.id).padStart(12, "0");
  const response = await searchOrders(padded);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(String(response.body.data[0].order_id), String(order.id));
});

dbTest("search non-angka mencocokkan email secara substring", async () => {
  const response = await searchOrders(user.email.toUpperCase());
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.data.map((item) => String(item.order_id)),
    [String(order.id)],
  );
});

dbTest("search potongan ID numerik tidak mencocokkan ID pesanan", async () => {
  const partialId = String(order.id).slice(0, -1);
  const response = await searchOrders(partialId);
  assert.equal(response.status, 200);
  const ids = response.body.data.map((item) => String(item.order_id));
  assert.ok(!ids.includes(String(order.id)));
});

dbTest("search ID dengan tambahan digit tidak mencocokkan ID pesanan", async () => {
  const extendedId = `${order.id}0`;
  const response = await searchOrders(extendedId);
  assert.equal(response.status, 200);
  const ids = response.body.data.map((item) => String(item.order_id));
  assert.ok(!ids.includes(String(order.id)));
});

dbTest("search potongan email mencocokkan email secara substring", async () => {
  const localPart = user.email.split("@")[0];
  const fragment = localPart.slice(0, localPart.lastIndexOf("-"));
  const response = await searchOrders(fragment);
  assert.equal(response.status, 200);
  const ids = response.body.data.map((item) => String(item.order_id));
  assert.ok(ids.includes(String(order.id)));
});

dbTest("search nama user tidak mencocokkan pesanan", async () => {
  const response = await searchOrders(user.name);
  assert.equal(response.status, 200);
  const ids = response.body.data.map((item) => String(item.order_id));
  assert.ok(!ids.includes(String(order.id)));
});

dbTest("search non-angka tidak mencocokkan ID", async () => {
  const response = await searchOrders(`id-${order.id}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
});

dbTest("search angka tidak mencocokkan email", async () => {
  const collision = await db.query(
    "SELECT 1 FROM orders WHERE id = $1::bigint",
    [numericToken],
  );
  assert.equal(collision.rowCount, 0);

  const response = await searchOrders(numericToken);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
});

dbTest("search angka di luar bigint mengembalikan 200 dan data kosong", async () => {
  const response = await searchOrders("9223372036854775808");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
  assert.equal(response.body.pagination.totalItems, 0);
});

dbTest("search dapat digabung dengan filter status", async () => {
  const mismatch = await searchOrders(order.id, "&status=PAID");
  assert.equal(mismatch.status, 200);
  assert.deepEqual(mismatch.body.data, []);

  const match = await searchOrders(order.id, "&status=PENDING");
  assert.equal(match.status, 200);
  assert.equal(match.body.data.length, 1);
  assert.equal(String(match.body.data[0].order_id), String(order.id));
});

dbTest("search email dapat digabung dengan filter status", async () => {
  const mismatch = await searchOrders(user.email, "&status=PAID");
  assert.equal(mismatch.status, 200);
  const mismatchIds = mismatch.body.data.map((item) =>
    String(item.order_id),
  );
  assert.ok(!mismatchIds.includes(String(order.id)));

  const match = await searchOrders(user.email, "&status=PENDING");
  assert.equal(match.status, 200);
  const matchIds = match.body.data.map((item) => String(item.order_id));
  assert.ok(matchIds.includes(String(order.id)));
});

dbTest("search berisi spasi tidak memfilter hasil", async () => {
  const response = await searchOrders("   ");
  assert.equal(response.status, 200);
  const ids = response.body.data.map((item) => String(item.order_id));
  assert.ok(ids.includes(String(order.id)));
  assert.ok(ids.includes(String(otherOrder.id)));
});
