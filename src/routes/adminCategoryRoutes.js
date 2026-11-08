const express = require("express");
const router = express.Router();
const adminCategoryController = require("../controllers/adminCategoryController");
const { verifyAdminToken } = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const {
  listQuery,
  idParams,
  createBody,
  updateBody,
} = require("../validation/categorySchemas");

router.get(
  "/categories",
  verifyAdminToken,
  validate({ query: listQuery }),
  adminCategoryController.getCategoryList,
);

router.get(
  "/categories/:id",
  verifyAdminToken,
  validate({ params: idParams }),
  adminCategoryController.getCategoryDetail,
);

router.post(
  "/categories",
  verifyAdminToken,
  validate({ body: createBody }),
  adminCategoryController.createCategory,
);

router.put(
  "/categories/:id",
  verifyAdminToken,
  validate({ params: idParams, body: updateBody }),
  adminCategoryController.updateCategory,
);

router.delete(
  "/categories/:id",
  verifyAdminToken,
  validate({ params: idParams }),
  adminCategoryController.deleteCategory,
);

module.exports = router;
