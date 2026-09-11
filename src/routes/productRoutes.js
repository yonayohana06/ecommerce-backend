const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const verifyAuthToken = require('../middlewares/authMiddleware');

// GET / (prefix /api/products)
router.get('/', verifyAuthToken, productController.getProductList);

// GET /products/:id
router.get('/:id', verifyAuthToken, productController.getProductDetail);

module.exports = router;