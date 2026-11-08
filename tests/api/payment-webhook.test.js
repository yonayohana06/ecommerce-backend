const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

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
  createOrderWithItems,
  cleanup,
  db,
} = require("../helpers/api");

const supabase = require("../../src/config/supabase");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);

let closeServer;
let baseUrl;
let user;
let userToken;
let adminToken;
let product;
let originalStorageFrom;
const productIds = [];
const userIds = [];
const storageMock = { uploaded: null, removed: [], signedUrlRequest: null };

function proofForm(fileName = "proof.png", type = "image/png") {
  const formData = new FormData();
  formData.append(
    "proof_image",
    new Blob([Buffer.from("fake-image-bytes")], { type }),
    fileName,
  );
  return formData;
}

function sign(orderId, statusCode, grossAmount) {
  return crypto
    .createHash("sha512")
    .update(
      `${orderId}${statusCode}${grossAmount}${process.env.PAYMENT_SERVER_KEY}`,
    )
    .digest("hex");
}

async function postWebhook({
  orderId,
  transactionStatus,
  grossAmount,
  statusCode = "200",
  signature,
}) {
  return request(baseUrl, "/api/orders/webhook/payment", {
    method: "POST",
    body: {
      order_id: String(orderId),
      status_code: statusCode,
      gross_amount: grossAmount,
      transaction_status: transactionStatus,
      signature_key:
        signature === undefined
          ? sign(orderId, statusCode, grossAmount)
          : signature,
    },
  });
}

async function getOrder(orderId) {
  const result = await db.query("SELECT * FROM orders WHERE id = $1", [
    orderId,
  ]);
  return result.rows[0];
}

async function getStock() {
  const result = await db.query("SELECT stock FROM products WHERE id = $1", [
    product.id,
  ]);
  return result.rows[0].stock;
}

before(async () => {
  if (!runDbTests) return;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;

  originalStorageFrom = supabase.storage.from.bind(supabase.storage);
  supabase.storage.from = (bucket) => ({
    upload: async (fileName, buffer, options) => {
      storageMock.uploaded = {
        bucket,
        fileName,
        size: buffer.length,
        options,
      };
      return { data: { path: fileName }, error: null };
    },
    remove: async (paths) => {
      storageMock.removed.push(...paths);
      return { error: null };
    },
    createSignedUrl: async (fileName, expiresIn) => {
      storageMock.signedUrlRequest = { fileName, expiresIn };
      return {
        data: { signedUrl: `https://example.test/${fileName}` },
        error: null,
      };
    },
  });

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
    name: `Produk Payment ${uniqueSuffix()}`,
    price: 10000,
    stock: 10,
  });
  productIds.push(product.id);
});

after(async () => {
  if (!runDbTests) return;

  if (originalStorageFrom) {
    supabase.storage.from = originalStorageFrom;
  }

  await cleanup({ userIds, productIds });

  if (closeServer) {
    await closeServer();
  }

  await db.pool.end();
});

dbTest("upload bukti bayar tanpa file ditolak 400", async () => {
  const formData = new FormData();
  formData.append("catatan", "tanpa file");

  const response = await request(baseUrl, "/api/orders/999999/pay", {
    method: "POST",
    token: userToken,
    formData,
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /wajib diunggah/i);
});

dbTest("upload bukti bayar untuk pesanan yang tidak ada ditolak 400", async () => {
  const response = await request(baseUrl, "/api/orders/999999/pay", {
    method: "POST",
    token: userToken,
    formData: proofForm(),
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /tidak ditemukan/i);
});

dbTest("upload bukti bayar valid mengubah status ke PROCESSING", async () => {
  const order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    quantity: 2,
    price: 10000,
    stock: 8,
  });

  storageMock.uploaded = null;

  const response = await request(baseUrl, `/api/orders/${order.id}/pay`, {
    method: "POST",
    token: userToken,
    formData: proofForm("bukti-valid.png"),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, "PROCESSING");
  assert.equal(response.body.data.payment_proof_url, storageMock.uploaded.fileName);
  assert.equal(storageMock.uploaded.bucket, "payment-proofs");
  assert.equal(storageMock.uploaded.options.contentType, "image/png");
  assert.ok(response.body.data.payment_submitted_at);

  const stored = await getOrder(order.id);
  assert.equal(stored.status, "PROCESSING");
  assert.equal(stored.payment_proof_url, storageMock.uploaded.fileName);
});

dbTest("upload bukti bayar kedua ditolak karena bukan PENDING", async () => {
  const order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    quantity: 1,
    price: 10000,
    status: "PROCESSING",
    stock: 9,
  });

  const response = await request(baseUrl, `/api/orders/${order.id}/pay`, {
    method: "POST",
    token: userToken,
    formData: proofForm(),
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /tidak dalam status PENDING/i);
});

dbTest("admin mengubah status mengembalikan signed URL bukti bayar", async () => {
  const order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    quantity: 1,
    price: 10000,
    status: "PROCESSING",
    stock: 9,
  });

  await db.query(
    `UPDATE orders
     SET payment_proof_url = 'proof-signed.png', payment_submitted_at = NOW()
     WHERE id = $1`,
    [order.id],
  );

  storageMock.signedUrlRequest = null;

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
  assert.equal(response.body.data.status, "PAID");
  assert.equal(
    response.body.data.payment_proof_url,
    "https://example.test/proof-signed.png",
  );
  assert.deepEqual(storageMock.signedUrlRequest, {
    fileName: "proof-signed.png",
    expiresIn: 3600,
  });
});

dbTest("webhook dengan signature tidak valid ditolak 403", async () => {
  const order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    quantity: 2,
    price: 10000,
    stock: 8,
  });

  const response = await postWebhook({
    orderId: order.id,
    transactionStatus: "settlement",
    grossAmount: "20000.00",
    signature: "signature-palsu",
  });

  assert.equal(response.status, 403);
  assert.equal((await getOrder(order.id)).status, "PENDING");
});

dbTest("webhook menolak transaction_status yang tidak dikenal", async () => {
  const order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    quantity: 2,
    price: 10000,
    stock: 8,
  });

  const response = await postWebhook({
    orderId: order.id,
    transactionStatus: "refund",
    grossAmount: "20000.00",
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /tidak dikenal/i);
  assert.equal((await getOrder(order.id)).status, "PENDING");
});

dbTest("webhook menolak gross_amount yang tidak cocok", async () => {
  const order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    quantity: 2,
    price: 10000,
    stock: 8,
  });

  const response = await postWebhook({
    orderId: order.id,
    transactionStatus: "settlement",
    grossAmount: "15000.00",
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /nominal pembayaran tidak cocok/i);
  assert.equal((await getOrder(order.id)).status, "PENDING");
  assert.equal(await getStock(), 8);
});

dbTest("webhook settlement mengubah status ke PAID tanpa mengubah stok", async () => {
  const order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    quantity: 2,
    price: 10000,
    stock: 8,
  });

  const response = await postWebhook({
    orderId: order.id,
    transactionStatus: "settlement",
    grossAmount: "20000.00",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, "PAID");
  assert.equal(response.body.data.already_processed, false);
  assert.equal(await getStock(), 8);
});

dbTest("webhook duplikat bersifat idempotent", async () => {
  const order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    quantity: 2,
    price: 10000,
    stock: 8,
  });

  const first = await postWebhook({
    orderId: order.id,
    transactionStatus: "settlement",
    grossAmount: "20000.00",
  });
  const duplicate = await postWebhook({
    orderId: order.id,
    transactionStatus: "settlement",
    grossAmount: "20000.00",
  });

  assert.equal(first.status, 200);
  assert.equal(first.body.data.already_processed, false);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.data.already_processed, true);
  assert.equal(await getStock(), 8);
});

dbTest("webhook expire membatalkan pesanan dan mengembalikan stok", async () => {
  const order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    quantity: 2,
    price: 10000,
    stock: 8,
  });

  const response = await postWebhook({
    orderId: order.id,
    transactionStatus: "expire",
    grossAmount: "20000.00",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, "CANCELLED");
  assert.equal(await getStock(), 10);
});

dbTest("webhook untuk pesanan yang tidak ada mengembalikan 404", async () => {
  const response = await postWebhook({
    orderId: 999999999,
    transactionStatus: "settlement",
    grossAmount: "10000.00",
  });

  assert.equal(response.status, 404);
  assert.match(response.body.message, /tidak ditemukan/i);
});
