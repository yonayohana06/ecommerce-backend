const express = require("express");
const router = express.Router();
const productController = require("../controllers/adminProductController");
const { verifyAdminToken } = require("../middlewares/authMiddleware");

router.get("/products", verifyAdminToken, productController.getProductList);

router.get(
  "/products/:id",
  verifyAdminToken,
  productController.getProductDetail,
);

router.post("/products", verifyAdminToken, productController.createProduct);

router.put(
  "/products/:id",
  verifyAdminToken,
  productController.updateProduct,
);

router.delete(
  "/products/:id",
  verifyAdminToken,
  productController.deleteProduct,
);

module.exports = router;
