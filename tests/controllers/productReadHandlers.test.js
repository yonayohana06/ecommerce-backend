const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createProductReadHandlers,
} = require("../../src/controllers/productReadHandlers");

const createRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

test("getProductList meneruskan query dan pagination", async () => {
  const calls = [];
  const handlers = createProductReadHandlers({
    listProducts: async (args) => {
      calls.push(args);
      return {
        products: [{ id: 1 }],
        pagination: { currentPage: 2, limit: 5 },
      };
    },
    getProductById: async () => null,
  });

  const req = {
    query: { category_id: "3", search: "kopi", page: "2", limit: "5" },
  };
  const res = createRes();
  let nextError;

  await handlers.getProductList(req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
  assert.deepEqual(calls[0], {
    categoryId: "3",
    search: "kopi",
    page: 2,
    limit: 5,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    code: 200,
    message: "Berhasil mengambil daftar produk",
    data: [{ id: 1 }],
    pagination: { currentPage: 2, limit: 5 },
  });
});

test("getProductDetail menolak ID tidak valid tanpa memanggil service", async () => {
  let called = false;
  const handlers = createProductReadHandlers({
    listProducts: async () => null,
    getProductById: async () => {
      called = true;
      return null;
    },
  });

  const res = createRes();
  let nextError;

  await handlers.getProductDetail(
    { params: { id: "abc" } },
    res,
    (error) => {
      nextError = error;
    },
  );

  assert.equal(called, false);
  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "ID produk tidak valid");
});

test("getProductDetail mengembalikan 404 dan 200", async () => {
  const missingHandlers = createProductReadHandlers({
    listProducts: async () => null,
    getProductById: async () => null,
  });
  const missingRes = createRes();
  await missingHandlers.getProductDetail(
    { params: { id: "99" } },
    missingRes,
    () => {},
  );
  assert.equal(missingRes.statusCode, 404);
  assert.equal(missingRes.body.message, "Produk tidak ditemukan");

  const foundHandlers = createProductReadHandlers({
    listProducts: async () => null,
    getProductById: async () => ({ id: 99, name: "Produk" }),
  });
  const foundRes = createRes();
  await foundHandlers.getProductDetail(
    { params: { id: "99" } },
    foundRes,
    () => {},
  );
  assert.equal(foundRes.statusCode, 200);
  assert.deepEqual(foundRes.body, {
    code: 200,
    message: "Berhasil mengambil detail produk",
    data: { id: 99, name: "Produk" },
  });
});

test("error service diteruskan ke next", async () => {
  const failure = new Error("db down");
  const handlers = createProductReadHandlers({
    listProducts: async () => {
      throw failure;
    },
    getProductById: async () => null,
  });

  let received;
  await handlers.getProductList({ query: {} }, createRes(), (error) => {
    received = error;
  });

  assert.equal(received, failure);
});
