const express = require("express");
const router = express.Router();
const categoryController = require("../controllers/categoryController");
const validate = require("../middlewares/validate");
const {
  listQuery,
  idParams,
  slugParams,
} = require("../validation/categorySchemas");

router.get(
  "/",
  validate({ query: listQuery }),
  categoryController.getCategoryList,
);
router.get(
  "/slug/:slug",
  validate({ params: slugParams }),
  categoryController.getCategoryBySlug,
);
router.get(
  "/:id",
  validate({ params: idParams }),
  categoryController.getCategoryDetail,
);

module.exports = router;
