const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  startTestServer,
  request,
  signToken,
  db,
} = require("../helpers/api");

let closeServer;
let baseUrl;

const userToken = () =>
  signToken(
    {
      userId: 1,
      email: "user-validation@example.com",
      role: "user",
      type: "user",
    },
    process.env.JWT_SECRET,
  );

before(async () => {
  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;
});

after(async () => {
  if (closeServer) {
    await closeServer();
  }

  await db.pool.end();
});

test("route tidak dikenal mengembalikan 404 JSON", async () => {
  const response = await request(baseUrl, "/api/does-not-exist");

  assert.equal(response.status, 404);
  assert.equal(response.body.code, 404);
  assert.match(response.body.message, /tidak ditemukan/i);
});

test("malformed JSON mengembalikan 400 JSON, bukan HTML", async () => {
  const response = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    rawBody: "{bad json",
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, 400);
  assert.match(response.body.message, /json/i);
  assert.equal(Object.hasOwn(response.body, "error"), false);
});

test("file upload melebihi batas mengembalikan 400 JSON", async () => {
  const formData = new FormData();
  formData.append(
    "proof_image",
    new Blob([new Uint8Array(3 * 1024 * 1024)], { type: "image/png" }),
    "besar.png",
  );

  const response = await request(baseUrl, "/api/orders/1/pay", {
    method: "POST",
    token: userToken(),
    formData,
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, 400);
  assert.match(response.body.message, /terlalu besar/i);
});

test("file upload dengan tipe salah mengembalikan 400 JSON", async () => {
  const formData = new FormData();
  formData.append(
    "proof_image",
    new Blob(["bukan gambar"], { type: "text/plain" }),
    "catatan.txt",
  );

  const response = await request(baseUrl, "/api/orders/1/pay", {
    method: "POST",
    token: userToken(),
    formData,
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, 400);
  assert.match(response.body.message, /gambar/i);
});
