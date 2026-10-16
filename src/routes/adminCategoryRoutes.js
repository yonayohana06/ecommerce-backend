const express = require("express");
const router = express.Router();
const adminCategoryController = require("../controllers/adminCategoryController");
const { verifyAuthToken, authorize } = require("../middlewares/authMiddleware");

router.get(
  "/categories",
  verifyAuthToken,
  authorize("admin"),
  adminCategoryController.getCategoryList,
);

router.get(
  "/categories/:id",
  verifyAuthToken,
  authorize("admin"),
  adminCategoryController.getCategoryDetail,
);

router.post(
  "/categories",
  verifyAuthToken,
  authorize("admin"),
  adminCategoryController.createCategory,
);

router.put(
  "/categories/:id",
  verifyAuthToken,
  authorize("admin"),
  adminCategoryController.updateCategory,
);

router.delete(
  "/categories/:id",
  verifyAuthToken,
  authorize("admin"),
  adminCategoryController.deleteCategory,
);

module.exports = router;
