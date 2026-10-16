const express = require("express");
const router = express.Router();
const productController = require("../controllers/adminProductController");
const { verifyAuthToken, authorize } = require("../middlewares/authMiddleware");

router.get(
  "/products",
  verifyAuthToken,
  authorize("admin"),
  productController.getProductList,
);

router.get(
  "/products/:id",
  verifyAuthToken,
  authorize("admin"),
  productController.getProductDetail,
);

router.post(
  "/products",
  verifyAuthToken,
  authorize("admin"),
  productController.createProduct,
);

router.put(
  "/products/:id",
  verifyAuthToken,
  authorize("admin"),
  productController.updateProduct,
);

router.delete(
  "/products/:id",
  verifyAuthToken,
  authorize("admin"),
  productController.deleteProduct,
);

module.exports = router;
