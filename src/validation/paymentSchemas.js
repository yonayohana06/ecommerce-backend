const {
  z,
  ORDER_STATUS_VALUES,
  ORDER_STATUS_MESSAGE,
  positiveId,
  paginationFields,
  orderStatusFilter,
} = require("./common");

const orderIdParams = z.object({
  orderId: positiveId("ID pesanan tidak valid"),
});

const statusBody = z.object({
  status: z.enum(ORDER_STATUS_VALUES, {
    error: ORDER_STATUS_MESSAGE,
  }),
});

const adminOrdersQuery = z.object({
  status: orderStatusFilter,
  search: z
    .string({ error: "search harus berupa teks" })
    .max(150, "search maksimal 150 karakter.")
    .optional(),
  ...paginationFields,
});

module.exports = {
  orderIdParams,
  statusBody,
  adminOrdersQuery,
};
