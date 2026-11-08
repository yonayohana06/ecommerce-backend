const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  toNumber,
  serializeProduct,
  serializeCartItem,
  serializeOrder,
} = require("../../src/utils/serializers");

test("toNumber mengubah string numeric menjadi number", () => {
  assert.equal(toNumber("1950000.00"), 1950000);
  assert.equal(toNumber("25000"), 25000);
  assert.equal(toNumber(1500), 1500);
});

test("toNumber mempertahankan null dan undefined", () => {
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), undefined);
});

test("toNumber mengembalikan null untuk nilai yang tidak valid", () => {
  assert.equal(toNumber("abc"), null);
});

test("serializeProduct mengubah price menjadi number", () => {
  const product = serializeProduct({ id: 1, name: "Produk", price: "25000.00" });

  assert.equal(product.price, 25000);
  assert.equal(product.name, "Produk");
});

test("serializeProduct mengembalikan null untuk input kosong", () => {
  assert.equal(serializeProduct(null), null);
  assert.equal(serializeProduct(undefined), null);
});

test("serializeCartItem mengubah price dan subtotal menjadi number", () => {
  const item = serializeCartItem({
    cart_item_id: 1,
    price: "10000.00",
    subtotal: "20000.00",
    quantity: 2,
  });

  assert.equal(item.price, 10000);
  assert.equal(item.subtotal, 20000);
  assert.equal(item.quantity, 2);
});

test("serializeOrder mengubah total_amount dan item terkait", () => {
  const order = serializeOrder({
    id: 1,
    total_amount: "20000.00",
    items: [
      {
        order_item_id: 1,
        price_at_purchase: "10000.00",
        subtotal: "20000.00",
      },
    ],
  });

  assert.equal(order.total_amount, 20000);
  assert.equal(order.items[0].price_at_purchase, 10000);
  assert.equal(order.items[0].subtotal, 20000);
});

test("serializeOrder tidak menambahkan items jika tidak ada", () => {
  const order = serializeOrder({ id: 1, total_amount: "5000.00" });

  assert.equal(order.total_amount, 5000);
  assert.equal("items" in order, false);
});
