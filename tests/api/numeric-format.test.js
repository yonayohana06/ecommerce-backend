const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  runDbTests,
  uniqueSuffix,
  startTestServer,
  request,
  registerUser,
  loginUser,
  createAdmin,
  loginAdmin,
  createProduct,
  cleanup,
  db,
} = require("../helpers/api");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);

let closeServer;
let baseUrl;
let user;
let userToken;
let adminToken;
let product;
let order;
let cartBeforeCheckout;
const productIds = [];
const userIds = [];

before(async () => {
  if (!runDbTests) return;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;

  const registered = await registerUser(baseUrl);
  assert.equal(registered.response.status, 201);
  user = registered.response.body.data;
  userIds.push(user.id);

  const login = await loginUser(baseUrl, registered.credentials);
  assert.equal(login.status, 200);
  userToken = login.body.data.token;

  const createdAdmin = await createAdmin();
  userIds.push(createdAdmin.admin.id);
  const adminLogin = await loginAdmin(baseUrl, createdAdmin.credentials);
  assert.equal(adminLogin.status, 200);
  adminToken = adminLogin.body.data.token;

  product = await createProduct({
    name: `Produk Numeric ${uniqueSuffix()}`,
    price: 25000,
    stock: 50,
  });
  productIds.push(product.id);

  const addCart = await request(baseUrl, "/api/cart", {
    method: "POST",
    token: userToken,
    body: { product_id: product.id, quantity: 2 },
  });
  assert.equal(addCart.status, 200);

  const cart = await request(baseUrl, "/api/cart", { token: userToken });
  assert.equal(cart.status, 200);
  cartBeforeCheckout = cart.body.data;

  const checkout = await request(baseUrl, "/api/orders/checkout", {
    method: "POST",
    token: userToken,
    body: { shipping_address: "Alamat Numeric Test" },
  });
  assert.equal(checkout.status, 201);
  order = checkout.body.data;
});

after(async () => {
  if (!runDbTests) return;

  await cleanup({ userIds, productIds });

  if (closeServer) {
    await closeServer();
  }

  await db.pool.end();
});

dbTest("product list dan detail mengembalikan price sebagai number", async () => {
  const list = await request(
    baseUrl,
    `/api/products?search=${encodeURIComponent(product.name)}`,
  );
  assert.equal(list.status, 200);

  const found = list.body.data.find((item) => item.id === product.id);
  assert.ok(found);
  assert.equal(typeof found.price, "number");
  assert.equal(found.price, 25000);

  const detail = await request(baseUrl, `/api/products/${product.id}`);
  assert.equal(detail.status, 200);
  assert.equal(typeof detail.body.data.price, "number");
  assert.equal(detail.body.data.price, 25000);
});

dbTest("cart mengembalikan price, subtotal, dan grand_total sebagai number", () => {
  const [item] = cartBeforeCheckout.items;

  assert.equal(typeof item.price, "number");
  assert.equal(item.price, 25000);
  assert.equal(typeof item.subtotal, "number");
  assert.equal(item.subtotal, 50000);
  assert.equal(typeof cartBeforeCheckout.grand_total, "number");
  assert.equal(cartBeforeCheckout.grand_total, 50000);
});

dbTest("checkout mengembalikan total_amount sebagai number", () => {
  assert.equal(typeof order.total_amount, "number");
  assert.equal(order.total_amount, 50000);
});

dbTest("order list dan detail user mengembalikan numeric sebagai number", async () => {
  const list = await request(baseUrl, "/api/orders", { token: userToken });
  assert.equal(list.status, 200);

  const found = list.body.data.find((item) => item.order_id === order.id);
  assert.ok(found);
  assert.equal(typeof found.total_amount, "number");
  assert.equal(found.total_amount, 50000);
  assert.equal(typeof found.items[0].price_at_purchase, "number");
  assert.equal(typeof found.items[0].subtotal, "number");

  const detail = await request(baseUrl, `/api/orders/${order.id}`, {
    token: userToken,
  });
  assert.equal(detail.status, 200);
  assert.equal(typeof detail.body.data.total_amount, "number");
  assert.equal(detail.body.data.total_amount, 50000);
  assert.equal(typeof detail.body.data.items[0].price_at_purchase, "number");
  assert.equal(typeof detail.body.data.items[0].subtotal, "number");
});

dbTest("admin product create dan update mengembalikan price sebagai number", async () => {
  const created = await request(baseUrl, "/api/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Produk Admin Numeric ${uniqueSuffix()}`,
      price: 15000,
      stock: 4,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(typeof created.body.data.price, "number");
  assert.equal(created.body.data.price, 15000);
  productIds.push(created.body.data.id);

  const updated = await request(
    baseUrl,
    `/api/admin/products/${created.body.data.id}`,
    {
      method: "PUT",
      token: adminToken,
      body: { price: 17500 },
    },
  );
  assert.equal(updated.status, 200);
  assert.equal(typeof updated.body.data.price, "number");
  assert.equal(updated.body.data.price, 17500);
});

dbTest("admin order list dan detail mengembalikan numeric sebagai number", async () => {
  const list = await request(baseUrl, "/api/admin/orders?limit=100", {
    token: adminToken,
  });
  assert.equal(list.status, 200);

  const found = list.body.data.find((item) => item.order_id === order.id);
  assert.ok(found);
  assert.equal(typeof found.total_amount, "number");
  assert.equal(found.total_amount, 50000);

  const detail = await request(baseUrl, `/api/admin/orders/${order.id}`, {
    token: adminToken,
  });
  assert.equal(detail.status, 200);
  assert.equal(typeof detail.body.data.total_amount, "number");
  assert.equal(detail.body.data.total_amount, 50000);
  assert.equal(typeof detail.body.data.items[0].price_at_purchase, "number");
  assert.equal(typeof detail.body.data.items[0].subtotal, "number");
});

dbTest("admin ubah status mengembalikan total_amount sebagai number", async () => {
  const response = await request(
    baseUrl,
    `/api/admin/orders/${order.id}/status`,
    {
      method: "PATCH",
      token: adminToken,
      body: { status: "PROCESSING" },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, "PROCESSING");
  assert.equal(typeof response.body.data.total_amount, "number");
  assert.equal(response.body.data.total_amount, 50000);
});

dbTest("summary admin mengembalikan totalRevenue sebagai number", async () => {
  const response = await request(baseUrl, "/api/admin/orders/summary", {
    token: adminToken,
  });

  assert.equal(response.status, 200);
  assert.equal(typeof response.body.data.totalRevenue, "number");
});
