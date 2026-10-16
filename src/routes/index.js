const express = require("express");
const router = express.Router();
const productRoutes = require("./productRoutes");
const adminProductRoutes = require("./adminProductRoutes");

router.use("/products", productRoutes);
router.use("/admin", adminProductRoutes);

module.exports = router;
