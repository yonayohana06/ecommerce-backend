const {
  z,
  requiredString,
  positiveId,
  paginationFields,
  orderStatusFilter,
} = require("./common");

const checkoutBody = z.object({
  shipping_address: requiredString(
    "Alamat pengiriman (shipping_address) wajib diisi",
  )
    .trim()
    .min(1, "Alamat pengiriman (shipping_address) wajib diisi")
    .max(1000, "Alamat pengiriman maksimal 1000 karakter."),
});

const listQuery = z.object({
  status: orderStatusFilter,
  ...paginationFields,
});

const idParams = z.object({
  id: positiveId("ID pesanan tidak valid"),
});

const webhookBody = z.object({
  order_id: z.preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    positiveId("order_id tidak valid"),
  ),
  transaction_status: requiredString("transaction_status wajib diisi").min(
    1,
    "transaction_status wajib diisi",
  ),
  gross_amount: z.preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    requiredString("gross_amount wajib diisi").trim().min(
      1,
      "gross_amount wajib diisi",
    ),
  ),
});

module.exports = {
  checkoutBody,
  listQuery,
  idParams,
  webhookBody,
};
