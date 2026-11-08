const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  runDbTests,
  startTestServer,
  request,
  signToken,
  db,
} = require("../helpers/api");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);

let closeServer;
let baseUrl;

const adminToken = () =>
  signToken(
    { userId: 1, email: "admin-validation@example.com", role: "admin" },
    process.env.ADMIN_JWT_SECRET,
  );

const userToken = () =>
  signToken(
    { userId: 1, email: "user-validation@example.com", role: "user" },
    process.env.JWT_SECRET,
  );

const paymentSignature = (orderId, statusCode, grossAmount) =>
  crypto
    .createHash("sha512")
    .update(
      `${orderId}${statusCode}${grossAmount}${process.env.PAYMENT_SERVER_KEY}`,
    )
    .digest("hex");

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

  await db.pool.end();
});

dbTest("query category_id tidak valid ditolak 400 tanpa detail DB", async () => {
  const response = await request(baseUrl, "/api/products?category_id=abc");

  assert.equal(response.status, 400);
  assert.equal(response.body.code, 400);
  assert.match(response.body.message, /category_id/i);
  assert.equal(Object.hasOwn(response.body, "error"), false);
  assert.doesNotMatch(JSON.stringify(response.body), /invalid input syntax/i);
});

dbTest("pagination tidak valid ditolak 400", async () => {
  for (const path of [
    "/api/products?page=abc",
    "/api/products?page=0",
    "/api/products?limit=0",
    "/api/products?limit=101",
  ]) {
    const response = await request(baseUrl, path);

    assert.equal(response.status, 400, `path ${path} seharusnya 400`);
    assert.equal(response.body.code, 400);
  }
});

dbTest("ID produk dan kategori non-integer ditolak 400", async () => {
  const product = await request(baseUrl, "/api/products/1.5");
  assert.equal(product.status, 400);
  assert.match(product.body.message, /tidak valid/i);

  const category = await request(baseUrl, "/api/categories/1.5");
  assert.equal(category.status, 400);
  assert.match(category.body.message, /tidak valid/i);
});

dbTest("create product memvalidasi harga, stok, dan category_id", async () => {
  const token = adminToken();

  const invalidPrice = await request(baseUrl, "/api/admin/products", {
    method: "POST",
    token,
    body: { name: "Produk Harga Salah", price: "abc", stock: 1 },
  });
  assert.equal(invalidPrice.status, 400);
  assert.match(invalidPrice.body.message, /harga/i);

  const negativeStock = await request(baseUrl, "/api/admin/products", {
    method: "POST",
    token,
    body: { name: "Produk Stok Negatif", price: 1000, stock: -1 },
  });
  assert.equal(negativeStock.status, 400);
  assert.match(negativeStock.body.message, /stok/i);

  const invalidCategory = await request(baseUrl, "/api/admin/products", {
    method: "POST",
    token,
    body: {
      name: "Produk Kategori Salah",
      price: 1000,
      stock: 1,
      category_id: "abc",
    },
  });
  assert.equal(invalidCategory.status, 400);
  assert.match(invalidCategory.body.message, /category_id/i);
});

dbTest("foreign key violation menjadi 400 tanpa detail database", async () => {
  const response = await request(baseUrl, "/api/admin/products", {
    method: "POST",
    token: adminToken(),
    body: {
      name: `Produk FK ${Date.now()}`,
      price: 10000,
      stock: 1,
      category_id: 999999999,
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, 400);
  assert.equal(Object.hasOwn(response.body, "error"), false);
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /foreign key|violates|insert or update/i,
  );
});

dbTest("ID produk pada update harus integer positif", async () => {
  const response = await request(baseUrl, "/api/admin/products/1.5", {
    method: "PUT",
    token: adminToken(),
    body: { stock: 1 },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /tidak valid/i);
});

dbTest("add to cart memvalidasi product_id dan quantity", async () => {
  const token = userToken();

  const invalidProduct = await request(baseUrl, "/api/cart", {
    method: "POST",
    token,
    body: { product_id: "abc", quantity: 1 },
  });
  assert.equal(invalidProduct.status, 400);
  assert.match(invalidProduct.body.message, /product/i);

  const invalidQuantity = await request(baseUrl, "/api/cart", {
    method: "POST",
    token,
    body: { product_id: 1, quantity: 1.5 },
  });
  assert.equal(invalidQuantity.status, 400);
  assert.match(invalidQuantity.body.message, /quantity|jumlah/i);
});

dbTest("update cart memvalidasi ID dan quantity", async () => {
  const token = userToken();

  const invalidId = await request(baseUrl, "/api/cart/1.5", {
    method: "PUT",
    token,
    body: { quantity: 1 },
  });
  assert.equal(invalidId.status, 400);
  assert.match(invalidId.body.message, /tidak valid/i);

  const invalidQuantity = await request(baseUrl, "/api/cart/1", {
    method: "PUT",
    token,
    body: { quantity: "abc" },
  });
  assert.equal(invalidQuantity.status, 400);
  assert.match(invalidQuantity.body.message, /quantity|jumlah/i);
});

dbTest("checkout menolak shipping_address kosong", async () => {
  const response = await request(baseUrl, "/api/orders/checkout", {
    method: "POST",
    token: userToken(),
    body: { shipping_address: "   " },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /wajib diisi/i);
});

dbTest("filter status pesanan user tidak valid ditolak 400", async () => {
  const response = await request(baseUrl, "/api/orders?status=REFUND", {
    token: userToken(),
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /status/i);
});

dbTest("filter status pesanan admin tidak valid ditolak 400", async () => {
  const response = await request(baseUrl, "/api/admin/orders?status=REFUND", {
    token: adminToken(),
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /status/i);
});

dbTest("status dan ID pesanan admin divalidasi", async () => {
  const invalidStatus = await request(
    baseUrl,
    "/api/admin/orders/1/status",
    {
      method: "PATCH",
      token: adminToken(),
      body: { status: "REFUND" },
    },
  );
  assert.equal(invalidStatus.status, 400);
  assert.match(invalidStatus.body.message, /status/i);

  const invalidId = await request(baseUrl, "/api/admin/orders/1.5/status", {
    method: "PATCH",
    token: adminToken(),
    body: { status: "PAID" },
  });
  assert.equal(invalidId.status, 400);
  assert.match(invalidId.body.message, /tidak valid/i);
});

dbTest("upload bukti bayar memvalidasi ID pesanan", async () => {
  const formData = new FormData();
  formData.append(
    "proof_image",
    new Blob(["fake-image"], { type: "image/png" }),
    "bukti.png",
  );

  const response = await request(baseUrl, "/api/orders/1.5/pay", {
    method: "POST",
    token: userToken(),
    formData,
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /tidak valid/i);
});

dbTest("webhook memvalidasi order_id sebelum menyentuh database", async () => {
  const response = await request(baseUrl, "/api/orders/webhook/payment", {
    method: "POST",
    body: {
      order_id: "abc",
      status_code: "200",
      gross_amount: "10000.00",
      transaction_status: "settlement",
      signature_key: paymentSignature("abc", "200", "10000.00"),
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, 400);
  assert.match(response.body.message, /order_id|tidak valid/i);
  assert.doesNotMatch(JSON.stringify(response.body), /invalid input syntax/i);
});
