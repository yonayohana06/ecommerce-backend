const express = require("express");
const router = express.Router();
const productRoutes = require("./productRoutes");
const adminProductRoutes = require("./adminProductRoutes");
const categoryRoutes = require("./categoryRoutes");
const adminCategoryRoutes = require("./adminCategoryRoutes");

router.use("/products", productRoutes);
router.use("/categories", categoryRoutes);
router.use("/admin", adminProductRoutes);
router.use("/admin", adminCategoryRoutes);

module.exports = router;

