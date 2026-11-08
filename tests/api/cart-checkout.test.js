const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  runDbTests,
  uniqueSuffix,
  startTestServer,
  request,
  registerUser,
  loginUser,
  createProduct,
  cleanup,
  db,
} = require("../helpers/api");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);

let closeServer;
let baseUrl;
let user;
let userToken;
let stockProduct;
let lowStockProduct;
let inactiveProduct;
const productIds = [];
const userIds = [];

async function addToCart(productId, quantity) {
  return request(baseUrl, "/api/cart", {
    method: "POST",
    token: userToken,
    body: { product_id: productId, quantity },
  });
}

async function getCart() {
  return request(baseUrl, "/api/cart", { token: userToken });
}

async function getProductStock(productId) {
  const result = await db.query("SELECT stock FROM products WHERE id = $1", [
    productId,
  ]);
  return result.rows[0].stock;
}

async function countUserOrders() {
  const result = await db.query(
    "SELECT COUNT(*)::int AS count FROM orders WHERE user_id = $1",
    [user.id],
  );
  return result.rows[0].count;
}

async function setProductActive(productId, isActive) {
  await db.query("UPDATE products SET is_active = $1 WHERE id = $2", [
    isActive,
    productId,
  ]);
}

async function setProductStock(productId, stock) {
  await db.query("UPDATE products SET stock = $1 WHERE id = $2", [
    stock,
    productId,
  ]);
}

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

  stockProduct = await createProduct({
    name: `Produk Checkout ${uniqueSuffix()}`,
    price: 10000,
    stock: 5,
  });
  productIds.push(stockProduct.id);

  lowStockProduct = await createProduct({
    name: `Produk Stok Rendah ${uniqueSuffix()}`,
    price: 10000,
    stock: 1,
  });
  productIds.push(lowStockProduct.id);

  inactiveProduct = await createProduct({
    name: `Produk Nonaktif ${uniqueSuffix()}`,
    price: 10000,
    stock: 5,
    isActive: false,
  });
  productIds.push(inactiveProduct.id);
});

beforeEach(async () => {
  if (!runDbTests) return;

  await request(baseUrl, "/api/cart", {
    method: "DELETE",
    token: userToken,
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

dbTest("menambah produk ke keranjang", async () => {
  const response = await addToCart(stockProduct.id, 2);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.quantity, 2);

  const cart = await getCart();
  assert.equal(cart.status, 200);
  assert.equal(cart.body.data.items.length, 1);
  assert.equal(cart.body.data.items[0].quantity, 2);
  assert.equal(Number(cart.body.data.items[0].subtotal), 20000);
  assert.equal(cart.body.data.grand_total, 20000);
});

dbTest("menambah produk yang sama mengakumulasi quantity", async () => {
  await addToCart(stockProduct.id, 1);
  const response = await addToCart(stockProduct.id, 2);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.quantity, 3);
});

dbTest("add to cart menolak produk nonaktif", async () => {
  const response = await addToCart(inactiveProduct.id, 1);

  assert.equal(response.status, 400);
  assert.match(response.body.message, /tidak aktif/i);

  const cart = await getCart();
  assert.equal(cart.body.data.items.length, 0);
});

dbTest("add to cart menolak quantity melebihi stok", async () => {
  const response = await addToCart(stockProduct.id, 6);

  assert.equal(response.status, 400);
  assert.match(response.body.message, /stok.*tidak mencukupi/i);
  assert.match(response.body.message, /tersisa 5/i);

  const cart = await getCart();
  assert.equal(cart.body.data.items.length, 0);
});

dbTest("add to cart menolak akumulasi quantity melebihi stok", async () => {
  const first = await addToCart(stockProduct.id, 3);
  assert.equal(first.status, 200);

  const second = await addToCart(stockProduct.id, 3);

  assert.equal(second.status, 400);
  assert.match(second.body.message, /stok.*tidak mencukupi/i);

  const cart = await getCart();
  assert.equal(cart.body.data.items.length, 1);
  assert.equal(cart.body.data.items[0].quantity, 3);
});

dbTest("add to cart menolak quantity bukan integer positif", async () => {
  for (const quantity of [1.5, "2.5", 0, -1]) {
    const response = await addToCart(stockProduct.id, quantity);

    assert.equal(response.status, 400, `quantity ${quantity} seharusnya ditolak`);
    assert.match(response.body.message, /product id dan quantity/i);
  }

  const cart = await getCart();
  assert.equal(cart.body.data.items.length, 0);
});

dbTest("update quantity melebihi stok ditolak 400", async () => {
  await addToCart(lowStockProduct.id, 1);

  const cart = await getCart();
  const itemId = cart.body.data.items[0].cart_item_id;

  const response = await request(baseUrl, `/api/cart/${itemId}`, {
    method: "PUT",
    token: userToken,
    body: { quantity: 3 },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /stok tidak mencukupi/i);
});

dbTest("update quantity valid berhasil", async () => {
  await addToCart(stockProduct.id, 1);

  const cart = await getCart();
  const itemId = cart.body.data.items[0].cart_item_id;

  const response = await request(baseUrl, `/api/cart/${itemId}`, {
    method: "PUT",
    token: userToken,
    body: { quantity: 4 },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.quantity, 4);
});

dbTest("hapus item keranjang", async () => {
  await addToCart(stockProduct.id, 1);

  const cart = await getCart();
  const itemId = cart.body.data.items[0].cart_item_id;

  const response = await request(baseUrl, `/api/cart/${itemId}`, {
    method: "DELETE",
    token: userToken,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.id, itemId);

  const emptyCart = await getCart();
  assert.equal(emptyCart.body.data.items.length, 0);
});

dbTest("kosongkan keranjang", async () => {
  await addToCart(stockProduct.id, 1);

  const response = await request(baseUrl, "/api/cart", {
    method: "DELETE",
    token: userToken,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.deleted_count, 1);

  const cart = await getCart();
  assert.equal(cart.body.data.items.length, 0);
});

dbTest("checkout keranjang kosong ditolak 400", async () => {
  const response = await request(baseUrl, "/api/orders/checkout", {
    method: "POST",
    token: userToken,
    body: { shipping_address: "Jl. Test" },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /keranjang belanja anda kosong/i);
});

dbTest("checkout tanpa shipping_address ditolak 400", async () => {
  await addToCart(stockProduct.id, 1);

  const response = await request(baseUrl, "/api/orders/checkout", {
    method: "POST",
    token: userToken,
    body: {},
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /wajib diisi/i);
});

dbTest("checkout sukses mengurangi stok dan mengosongkan keranjang", async () => {
  await addToCart(stockProduct.id, 2);

  const response = await request(baseUrl, "/api/orders/checkout", {
    method: "POST",
    token: userToken,
    body: { shipping_address: "Jl. Checkout Sukses" },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, "PENDING");
  assert.equal(Number(response.body.data.total_amount), 20000);

  assert.equal(await getProductStock(stockProduct.id), 3);

  const cart = await getCart();
  assert.equal(cart.body.data.items.length, 0);

  const orders = await request(baseUrl, "/api/orders", { token: userToken });
  assert.equal(orders.status, 200);
  assert.ok(orders.body.data.some((order) => order.order_id === response.body.data.id));

  const detail = await request(
    baseUrl,
    `/api/orders/${response.body.data.id}`,
    { token: userToken },
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.items.length, 1);
  assert.equal(detail.body.data.items[0].quantity, 2);
});

dbTest("checkout stok tidak cukup ditolak dan rollback", async () => {
  await addToCart(lowStockProduct.id, 1);

  // Stok berkurang setelah item masuk keranjang (mis. dibeli user lain).
  await setProductStock(lowStockProduct.id, 0);

  const ordersBefore = await countUserOrders();

  const response = await request(baseUrl, "/api/orders/checkout", {
    method: "POST",
    token: userToken,
    body: { shipping_address: "Jl. Stok Kurang" },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /stok produk.*tidak mencukupi/i);
  assert.equal(await getProductStock(lowStockProduct.id), 0);
  assert.equal(await countUserOrders(), ordersBefore);

  const cart = await getCart();
  assert.equal(cart.body.data.items.length, 1);
  assert.equal(cart.body.data.items[0].quantity, 1);
  assert.equal(cart.body.data.items[0].is_available, false);
  assert.equal(cart.body.data.grand_total, 0);

  await setProductStock(lowStockProduct.id, 1);
});

dbTest("produk nonaktif tetap terlihat, bisa dihapus, dan checkout memberi error jelas", async () => {
  const toggled = await createProduct({
    name: `Produk Toggle ${uniqueSuffix()}`,
    price: 10000,
    stock: 5,
  });
  productIds.push(toggled.id);

  const added = await addToCart(toggled.id, 2);
  assert.equal(added.status, 200);

  await setProductActive(toggled.id, false);

  const cart = await getCart();
  assert.equal(cart.status, 200);
  assert.equal(cart.body.data.items.length, 1);

  const item = cart.body.data.items[0];
  assert.equal(Number(item.product_id), Number(toggled.id));
  assert.equal(item.quantity, 2);
  assert.equal(item.is_available, false);
  assert.equal(Number(item.subtotal), 20000);
  assert.equal(cart.body.data.grand_total, 0);

  const checkout = await request(baseUrl, "/api/orders/checkout", {
    method: "POST",
    token: userToken,
    body: { shipping_address: "Jl. Produk Nonaktif" },
  });

  assert.equal(checkout.status, 400);
  assert.match(checkout.body.message, /tidak aktif/i);
  assert.equal(await getProductStock(toggled.id), 5);

  const deleted = await request(baseUrl, `/api/cart/${item.cart_item_id}`, {
    method: "DELETE",
    token: userToken,
  });
  assert.equal(deleted.status, 200);

  const emptyCart = await getCart();
  assert.equal(emptyCart.body.data.items.length, 0);
});

dbTest("user lain tidak dapat melihat detail pesanan", async () => {
  await addToCart(stockProduct.id, 1);

  const checkout = await request(baseUrl, "/api/orders/checkout", {
    method: "POST",
    token: userToken,
    body: { shipping_address: "Jl. Privasi" },
  });
  assert.equal(checkout.status, 201);

  const other = await registerUser(baseUrl);
  assert.equal(other.response.status, 201);
  userIds.push(other.response.body.data.id);

  const otherLogin = await loginUser(baseUrl, other.credentials);
  const otherToken = otherLogin.body.data.token;

  const response = await request(
    baseUrl,
    `/api/orders/${checkout.body.data.id}`,
    { token: otherToken },
  );

  assert.equal(response.status, 404);
});
