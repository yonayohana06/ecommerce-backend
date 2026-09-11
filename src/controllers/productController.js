const productService = require('../services/productService');

const getProductList = async (req, res) => {
    try {
        const { category_id, search, page = 1, limit = 10 } = req.query;

        const products = await productService.getProducts({
            categoryId: category_id,
            search: search,
            page: parseInt(page),
            limit: parseInt(limit),
        });

        return res.status(200).json({
            code: 200,
            message: 'Berhasil mengambil daftar produk',
            meta: {
                page: parseInt(page),
                limit: parseInt(limit),
                total_data: products.length,
            },
            data: products,
        });
    } catch (error) {
        console.error('Error fetching products:', error);
        return res.status(500).json({
            code: 500,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

const getProductDetail = async (req, res) => {
    try {
        const { id } = req.params;

        // Validasi jika ID bukan angka
        if (isNaN(id)) {
            return res.status(400).json({
                code: 400,
                message: 'ID produk tidak valid',
            });
        }

        const product = await productService.getProductById(id);

        if (!product) {
            return res.status(404).json({
                code: 404,
                message: 'Produk tidak ditemukan',
            });
        }

        return res.status(200).json({
            code: 200,
            message: 'Berhasil mengambil detail produk',
            data: product,
        });
    } catch (error) {
        console.error('Error fetching product detail:', error);
        return res.status(500).json({
            code: 500,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

module.exports = {
    getProductList,
    getProductDetail
};