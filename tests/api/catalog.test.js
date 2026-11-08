const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  runDbTests,
  uniqueSuffix,
  startTestServer,
  request,
  createAdmin,
  loginAdmin,
  cleanup,
  db,
} = require("../helpers/api");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);

let closeServer;
let baseUrl;
let admin;
let adminToken;
let category;
let product;
const productIds = [];
const categoryIds = [];
const userIds = [];

before(async () => {
  if (!runDbTests) return;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;

  const createdAdmin = await createAdmin();
  admin = createdAdmin.admin;
  userIds.push(admin.id);

  const login = await loginAdmin(baseUrl, createdAdmin.credentials);
  assert.equal(login.status, 200);
  adminToken = login.body.data.token;

  const suffix = uniqueSuffix();

  const categoryResponse = await request(baseUrl, "/api/admin/categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Kategori Integrasi ${suffix}` },
  });
  assert.equal(categoryResponse.status, 201);
  category = categoryResponse.body.data;
  categoryIds.push(category.id);

  const productResponse = await request(baseUrl, "/api/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Produk Integrasi ${suffix}`,
      description: "Produk untuk test integrasi",
      price: 25000,
      stock: 7,
      category_id: category.id,
    },
  });
  assert.equal(productResponse.status, 201);
  product = productResponse.body.data;
  productIds.push(product.id);
});

after(async () => {
  if (!runDbTests) return;

  await cleanup({ userIds, productIds, categoryIds });

  if (closeServer) {
    await closeServer();
  }

  await db.pool.end();
});

dbTest("admin dapat membuat kategori dan slug dibuat otomatis", () => {
  assert.ok(category.id);
  assert.match(category.slug, /^kategori-integrasi-/);
});

dbTest("kategori dengan nama duplikat ditolak 400", async () => {
  const response = await request(baseUrl, "/api/admin/categories", {
    method: "POST",
    token: adminToken,
    body: { name: category.name },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /sudah terdaftar/i);
});

dbTest("admin dapat membuat produk", () => {
  assert.equal(product.category_id, category.id);
  assert.equal(Number(product.price), 25000);
  assert.equal(product.stock, 7);
});

dbTest("produk tanpa nama ditolak 400", async () => {
  const response = await request(baseUrl, "/api/admin/products", {
    method: "POST",
    token: adminToken,
    body: { price: 1000, stock: 1 },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /wajib diisi/i);
});

dbTest("daftar produk publik mendukung pencarian", async () => {
  const response = await request(
    baseUrl,
    `/api/products?search=${encodeURIComponent(product.name)}`,
  );

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.data));
  assert.ok(response.body.data.some((item) => item.id === product.id));
});

dbTest("detail produk publik mengembalikan data yang benar", async () => {
  const response = await request(baseUrl, `/api/products/${product.id}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.id, product.id);
  assert.equal(Number(response.body.data.price), 25000);
});

dbTest("detail produk dengan ID tidak valid ditolak 400", async () => {
  const response = await request(baseUrl, "/api/products/abc");

  assert.equal(response.status, 400);
  assert.match(response.body.message, /tidak valid/i);
});

dbTest("detail produk yang tidak ada mengembalikan 404", async () => {
  const response = await request(baseUrl, "/api/products/999999999");

  assert.equal(response.status, 404);
  assert.match(response.body.message, /tidak ditemukan/i);
});

dbTest("kategori publik dapat diambil lewat daftar dan slug", async () => {
  const list = await request(baseUrl, "/api/categories");
  assert.equal(list.status, 200);
  assert.ok(list.body.data.some((item) => item.id === category.id));

  const detail = await request(
    baseUrl,
    `/api/categories/slug/${category.slug}`,
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.id, category.id);
});

dbTest("admin dapat memperbarui produk", async () => {
  const response = await request(
    baseUrl,
    `/api/admin/products/${product.id}`,
    {
      method: "PUT",
      token: adminToken,
      body: { price: 30000, stock: 12 },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(Number(response.body.data.price), 30000);
  assert.equal(response.body.data.stock, 12);

  const publicDetail = await request(baseUrl, `/api/products/${product.id}`);
  assert.equal(publicDetail.status, 200);
  assert.equal(Number(publicDetail.body.data.price), 30000);
  assert.equal(publicDetail.body.data.stock, 12);
});

dbTest("update produk yang tidak ada mengembalikan 404", async () => {
  const response = await request(
    baseUrl,
    "/api/admin/products/999999999",
    {
      method: "PUT",
      token: adminToken,
      body: { stock: 1 },
    },
  );

  assert.equal(response.status, 404);
});

dbTest("produk tanpa riwayat pesanan dihapus permanen", async () => {
  const created = await request(baseUrl, "/api/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Produk Hapus ${uniqueSuffix()}`,
      price: 5000,
      stock: 3,
    },
  });
  assert.equal(created.status, 201);
  productIds.push(created.body.data.id);

  const response = await request(
    baseUrl,
    `/api/admin/products/${created.body.data.id}`,
    { method: "DELETE", token: adminToken },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.data.delete_type, "hard_deleted");

  const detail = await request(
    baseUrl,
    `/api/admin/products/${created.body.data.id}`,
    { token: adminToken },
  );
  assert.equal(detail.status, 404);
});

dbTest("hapus kategori memindahkan produk terkait menjadi tanpa kategori", async () => {
  const suffix = uniqueSuffix();
  const createdCategory = await request(
    baseUrl,
    "/api/admin/categories",
    {
      method: "POST",
      token: adminToken,
      body: { name: `Kategori Hapus ${suffix}` },
    },
  );
  assert.equal(createdCategory.status, 201);
  categoryIds.push(createdCategory.body.data.id);

  const createdProduct = await request(baseUrl, "/api/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Produk Kategori Hapus ${suffix}`,
      price: 5000,
      stock: 3,
      category_id: createdCategory.body.data.id,
    },
  });
  assert.equal(createdProduct.status, 201);
  productIds.push(createdProduct.body.data.id);

  const response = await request(
    baseUrl,
    `/api/admin/categories/${createdCategory.body.data.id}`,
    { method: "DELETE", token: adminToken },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.data.affected_products_count, 1);

  const detail = await request(
    baseUrl,
    `/api/admin/products/${createdProduct.body.data.id}`,
    { token: adminToken },
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.category_id, null);
});
