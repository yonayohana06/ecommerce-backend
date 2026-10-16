const categoryService = require("../services/categoryService");

const getCategoryList = async (req, res) => {
  try {
    const { search } = req.query;
    const categories = await categoryService.getAllCategories({ search });

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil daftar kategori",
      data: categories,
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({
      code: 500,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getCategoryDetail = async (req, res) => {
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
    console.error("Error fetching category detail:", error);
    return res.status(500).json({
      code: 500,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getCategoryBySlug = async (req, res) => {
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
    console.error("Error fetching category by slug:", error);
    return res.status(500).json({
      code: 500,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports = {
  getCategoryList,
  getCategoryDetail,
  getCategoryBySlug,
};
