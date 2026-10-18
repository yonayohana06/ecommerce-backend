const express = require("express");
const router = express.Router();
const adminCategoryController = require("../controllers/adminCategoryController");
const { verifyAdminToken } = require("../middlewares/authMiddleware");

router.get("/categories", verifyAdminToken, adminCategoryController.getCategoryList);

router.get(
  "/categories/:id",
  verifyAdminToken,
  adminCategoryController.getCategoryDetail,
);

router.post(
  "/categories",
  verifyAdminToken,
  adminCategoryController.createCategory,
);

router.put(
  "/categories/:id",
  verifyAdminToken,
  adminCategoryController.updateCategory,
);

router.delete(
  "/categories/:id",
  verifyAdminToken,
  adminCategoryController.deleteCategory,
);

module.exports = router;
