const { z, positiveId, positiveInt } = require("./common");

const ADD_CART_MESSAGE = "Product ID dan quantity yang valid wajib diisi";
const UPDATE_QUANTITY_MESSAGE = "Jumlah (quantity) minimal harus 1";

const addBody = z.object({
  product_id: positiveInt(ADD_CART_MESSAGE),
  quantity: positiveInt(ADD_CART_MESSAGE),
});

const updateBody = z.object({
  quantity: positiveInt(UPDATE_QUANTITY_MESSAGE),
});

const idParams = z.object({
  id: positiveId("ID keranjang tidak valid"),
});

module.exports = {
  addBody,
  updateBody,
  idParams,
};
