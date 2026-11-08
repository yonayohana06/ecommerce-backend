const categoryService = require("../services/categoryService");

const getCategoryList = async (req, res, next) => {
  try {
    const { search } = req.query;
    const categories = await categoryService.getAllCategories({ search });

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil daftar kategori",
      data: categories,
    });
  } catch (error) {
    return next(error);
  }
};

const getCategoryDetail = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isNaN(id)) {
      return res.status(400).json({
        code: 400,
        message: "ID kategori tidak valid",
      });
    }

    const category = await categoryService.getCategoryById(id);

    if (!category) {
      return res.status(404).json({
        code: 404,
        message: "Kategori tidak ditemukan",
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil detail kategori",
      data: category,
    });
  } catch (error) {
    return next(error);
  }
};

const getCategoryBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        code: 400,
        message: "Slug kategori wajib disertakan",
      });
    }

    const category = await categoryService.getCategoryBySlug(slug);

    if (!category) {
      return res.status(404).json({
        code: 404,
        message: "Kategori tidak ditemukan",
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil detail kategori",
      data: category,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCategoryList,
  getCategoryDetail,
  getCategoryBySlug,
};
