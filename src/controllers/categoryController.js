const categoryService = require("../services/categoryService");
const {
  createCategoryReadHandlers,
} = require("./categoryReadHandlers");

const { getCategoryList, getCategoryDetail } = createCategoryReadHandlers({
  getAllCategories: categoryService.getAllCategories,
  getCategoryById: categoryService.getCategoryById,
  listMessage: "Berhasil mengambil daftar kategori",
});

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
