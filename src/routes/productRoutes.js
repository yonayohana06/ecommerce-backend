const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const { verifyAuthToken, authorize } = require("../middlewares/authMiddleware");

// GET / (prefix /api/products)
router.get("/", verifyAuthToken, productController.getProductList);

// GET /products/:id
router.get("/:id", verifyAuthToken, productController.getProductDetail);

router.post(
  "/",
  verifyAuthToken,
  authorize("admin"),
  productController.createProduct,
);

router.put(
  "/:id",
  verifyAuthToken,
  authorize("admin"),
  productController.updateProduct,
);

router.delete(
  "/:id",
  verifyAuthToken,
  authorize("admin"),
  productController.deleteProduct,
);

module.exports = router;
