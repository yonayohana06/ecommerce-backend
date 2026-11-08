// PostgreSQL mengembalikan kolom numeric sebagai string agar presisi tidak
// hilang. API kita memakai `numeric(12)` scale 0 untuk Rupiah, sehingga aman
// dikirim sebagai number dan frontend tidak perlu menebak tipe data.
const toNumber = (value) => {
  if (value === null || value === undefined) {
    return value;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

const serializeProduct = (product) => {
  if (!product) {
    return null;
  }

  return {
    ...product,
    price: toNumber(product.price),
  };
};

const serializeCartItem = (item) => ({
  ...item,
  price: toNumber(item.price),
  subtotal: toNumber(item.subtotal),
});

const serializeOrderItem = (item) => ({
  ...item,
  price_at_purchase: toNumber(item.price_at_purchase),
  subtotal: toNumber(item.subtotal),
});

const serializeOrder = (order) => {
  if (!order) {
    return null;
  }

  const serialized = {
    ...order,
    total_amount: toNumber(order.total_amount),
  };

  if (Array.isArray(order.items)) {
    serialized.items = order.items.map(serializeOrderItem);
  }

  return serialized;
};

module.exports = {
  toNumber,
  serializeProduct,
  serializeCartItem,
  serializeOrder,
  serializeOrderItem,
};
