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

module.exports = {
    getProductList,
};