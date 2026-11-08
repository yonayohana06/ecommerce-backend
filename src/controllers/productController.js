const productService = require("../services/productService");

const getProductList = async (req, res, next) => {
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
      message: "Berhasil mengambil daftar produk",
      data: products.products,
      pagination: products.pagination,
    });
  } catch (error) {
    return next(error);
  }
};

const getProductDetail = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validasi jika ID bukan angka
    if (isNaN(id)) {
      return res.status(400).json({
        code: 400,
        message: "ID produk tidak valid",
      });
    }

    const product = await productService.getProductById(id);

    if (!product) {
      return res.status(404).json({
        code: 404,
        message: "Produk tidak ditemukan",
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil detail produk",
      data: product,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getProductList,
  getProductDetail,
};
