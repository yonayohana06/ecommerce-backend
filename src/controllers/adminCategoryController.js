const categoryService = require("../services/categoryService");

const getCategoryList = async (req, res, next) => {
  try {
    const { search } = req.query;
    const categories = await categoryService.getAllCategories({ search });

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil daftar kategori admin",
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

const createCategory = async (req, res, next) => {
  try {
    const { name, slug, icon_url } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({
        code: 400,
        message: "Nama kategori wajib diisi",
      });
    }

    const newCategory = await categoryService.createCategory({
      name,
      slug,
      icon_url,
    });

    return res.status(201).json({
      code: 201,
      message: "Berhasil menambahkan kategori baru",
      data: newCategory,
    });
  } catch (error) {
    return next(error);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isNaN(id)) {
      return res.status(400).json({
        code: 400,
        message: "ID kategori tidak valid",
      });
    }

    const updatedCategory = await categoryService.updateCategory(id, req.body);

    if (!updatedCategory) {
      return res.status(404).json({
        code: 404,
        message: "Kategori tidak ditemukan",
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Berhasil memperbarui kategori",
      data: updatedCategory,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isNaN(id)) {
      return res.status(400).json({
        code: 400,
        message: "ID kategori tidak valid",
      });
    }

    const result = await categoryService.deleteCategory(id);

    if (!result) {
      return res.status(404).json({
        code: 404,
        message: "Kategori tidak ditemukan",
      });
    }

    const affected = result.affected_products_count;
    const infoMessage =
      affected > 0
        ? `Kategori berhasil dihapus. ${affected} produk terkait kini menjadi tanpa kategori.`
        : "Kategori berhasil dihapus.";

    return res.status(200).json({
      code: 200,
      message: infoMessage,
      data: {
        category: result.category,
        affected_products_count: affected,
      },
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCategoryList,
  getCategoryDetail,
  createCategory,
  updateCategory,
  deleteCategory,
};
