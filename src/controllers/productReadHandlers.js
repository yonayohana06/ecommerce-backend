const createProductReadHandlers = ({ listProducts, getProductById }) => {
  const getProductList = async (req, res, next) => {
    try {
      const { category_id, search, page = 1, limit = 10 } = req.query;

      const products = await listProducts({
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

      if (isNaN(id)) {
        return res.status(400).json({
          code: 400,
          message: "ID produk tidak valid",
        });
      }

      const product = await getProductById(id);

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

  return {
    getProductList,
    getProductDetail,
  };
};

module.exports = {
  createProductReadHandlers,
};
