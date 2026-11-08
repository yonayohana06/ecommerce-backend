const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  requiredString,
  positiveInt,
  nonNegativeNumber,
  orderStatus,
  ORDER_STATUS_MESSAGE,
} = require("../../src/validation/common");
const { createBody: createProductBody } = require("../../src/validation/productSchemas");
const { createBody: createCategoryBody } = require("../../src/validation/categorySchemas");
const { addBody: addCartBody } = require("../../src/validation/cartSchemas");
const { registerBody } = require("../../src/validation/authSchemas");
const { statusBody } = require("../../src/validation/paymentSchemas");

const issueMessage = (schema, value) => {
  const result = schema.safeParse(value);

  assert.equal(result.success, false);
  return result.error.issues[0].message;
};

const firstIssue = (schema, value) => {
  const result = schema.safeParse(value);

  assert.equal(result.success, false);
  return result.error.issues[0];
};

test("requiredString memakai pesan khusus untuk nilai hilang dan tipe salah", () => {
  assert.equal(issueMessage(requiredString("Wajib diisi"), undefined), "Wajib diisi");
  assert.equal(issueMessage(requiredString("Wajib diisi"), 123), "Wajib diisi");
});

test("positiveInt menolak non-angka, desimal, nol, dan negatif dengan pesan khusus", () => {
  for (const value of ["abc", 1.5, 0, -1]) {
    assert.equal(
      issueMessage(positiveInt("Harus bilangan bulat positif"), value),
      "Harus bilangan bulat positif",
    );
  }
});

test("nonNegativeNumber menolak Infinity dengan pesan khusus", () => {
  assert.equal(
    issueMessage(nonNegativeNumber("Harus angka valid"), Infinity),
    "Harus angka valid",
  );
});

test("status pesanan tidak valid memakai pesan daftar status", () => {
  assert.equal(issueMessage(orderStatus, "REFUND"), ORDER_STATUS_MESSAGE);
});

test("schema produk memakai pesan validasi Indonesia", () => {
  assert.equal(
    issueMessage(createProductBody, { price: 1000, stock: 1 }),
    "Nama produk wajib diisi",
  );
  assert.match(
    issueMessage(createProductBody, { name: "Produk", price: "abc", stock: 1 }),
    /harga/i,
  );
  const invalidCategory = firstIssue(createProductBody, {
    name: "Produk",
    price: 1000,
    stock: 1,
    category_id: "abc",
  });
  assert.deepEqual(invalidCategory.path, ["category_id"]);
  assert.match(invalidCategory.message, /bilangan bulat positif/i);
});

test("schema kategori, cart, auth, dan status admin memakai pesan Indonesia", () => {
  assert.equal(
    issueMessage(createCategoryBody, {}),
    "Nama kategori wajib diisi",
  );
  assert.equal(
    issueMessage(addCartBody, { quantity: 1 }),
    "Product ID dan quantity yang valid wajib diisi",
  );
  assert.equal(
    issueMessage(registerBody, { name: "Test", password: "rahasia" }),
    "Nama, email, dan password wajib diisi.",
  );
  assert.equal(issueMessage(statusBody, { status: "REFUND" }), ORDER_STATUS_MESSAGE);
});
