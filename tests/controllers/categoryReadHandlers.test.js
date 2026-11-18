const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createCategoryReadHandlers,
} = require("../../src/controllers/categoryReadHandlers");

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

const createHandlers = (overrides = {}) =>
  createCategoryReadHandlers({
    getAllCategories: async () => [{ id: 1 }],
    getCategoryById: async () => ({ id: 1 }),
    listMessage: "Berhasil mengambil daftar kategori",
    ...overrides,
  });

test("getCategoryList memakai listMessage yang diberikan", async () => {
  const publicRes = createRes();
  await createHandlers().getCategoryList(
    { query: {} },
    publicRes,
    () => {},
  );
  assert.equal(publicRes.body.message, "Berhasil mengambil daftar kategori");

  const adminRes = createRes();
  await createHandlers({
    listMessage: "Berhasil mengambil daftar kategori admin",
  }).getCategoryList({ query: {} }, adminRes, () => {});
  assert.equal(
    adminRes.body.message,
    "Berhasil mengambil daftar kategori admin",
  );
});

test("getCategoryDetail mempertahankan 400, 404, dan 200", async () => {
  const invalidRes = createRes();
  await createHandlers().getCategoryDetail(
    { params: { id: "abc" } },
    invalidRes,
    () => {},
  );
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.message, "ID kategori tidak valid");

  const missingRes = createRes();
  await createHandlers({
    getCategoryById: async () => null,
  }).getCategoryDetail({ params: { id: "99" } }, missingRes, () => {});
  assert.equal(missingRes.statusCode, 404);
  assert.equal(missingRes.body.message, "Kategori tidak ditemukan");

  const foundRes = createRes();
  await createHandlers().getCategoryDetail(
    { params: { id: "1" } },
    foundRes,
    () => {},
  );
  assert.equal(foundRes.statusCode, 200);
  assert.equal(foundRes.body.message, "Berhasil mengambil detail kategori");
});

test("error service diteruskan ke next", async () => {
  const failure = new Error("db down");
  let received;
  await createHandlers({
    getAllCategories: async () => {
      throw failure;
    },
  }).getCategoryList({ query: {} }, createRes(), (error) => {
    received = error;
  });
  assert.equal(received, failure);
});
