const createCategoryReadHandlers = ({
  getAllCategories,
  getCategoryById,
  listMessage,
}) => {
  const getCategoryList = async (req, res, next) => {
    try {
      const { search } = req.query;
      const categories = await getAllCategories({ search });

      return res.status(200).json({
        code: 200,
        message: listMessage,
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

      const category = await getCategoryById(id);

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

  return {
    getCategoryList,
    getCategoryDetail,
  };
};

module.exports = {
  createCategoryReadHandlers,
};
