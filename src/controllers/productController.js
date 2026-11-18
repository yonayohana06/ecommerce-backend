const productService = require("../services/productService");
const {
  createProductReadHandlers,
} = require("./productReadHandlers");

const { getProductList, getProductDetail } = createProductReadHandlers({
  listProducts: productService.getProducts,
  getProductById: productService.getProductById,
});

module.exports = {
  getProductList,
  getProductDetail,
};
