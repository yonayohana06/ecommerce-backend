const express = require("express");
const router = express.Router();
const productController = require("../controllers/adminProductController");
const { verifyAdminToken } = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const {
  listQuery,
  idParams,
  createBody,
  updateBody,
} = require("../validation/productSchemas");

router.get(
  "/products",
  verifyAdminToken,
  validate({ query: listQuery }),
  productController.getProductList,
);

router.get(
  "/products/:id",
  verifyAdminToken,
  validate({ params: idParams }),
  productController.getProductDetail,
);

router.post(
  "/products",
  verifyAdminToken,
  validate({ body: createBody }),
  productController.createProduct,
);

router.put(
  "/products/:id",
  verifyAdminToken,
  validate({ params: idParams, body: updateBody }),
  productController.updateProduct,
);

router.delete(
  "/products/:id",
  verifyAdminToken,
  validate({ params: idParams }),
  productController.deleteProduct,
);

module.exports = router;
