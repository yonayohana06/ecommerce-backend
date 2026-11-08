const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const validate = require("../middlewares/validate");
const { listQuery, idParams } = require("../validation/productSchemas");

router.get("/", validate({ query: listQuery }), productController.getProductList);

router.get(
  "/:id",
  validate({ params: idParams }),
  productController.getProductDetail,
);

module.exports = router;
