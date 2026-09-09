const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const verifyAuthToken = require('../middlewares/authMiddleware');

// GET / (prefix /api/products)
router.get('/', verifyAuthToken, productController.getProductList);

module.exports = router;