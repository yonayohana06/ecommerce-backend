const cartService = require("../services/cartService");

const addToCart = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { product_id, quantity } = req.body;

    if (!product_id || !quantity || quantity <= 0) {
      return res.status(400).json({
        code: 400,
        message: "Product ID dan quantity yang valid wajib diisi",
      });
    }

    const item = await cartService.addToCart(userId, product_id, quantity);

    return res.status(200).json({
      code: 200,
      message: "Berhasil menambahkan produk ke keranjang",
      data: item,
    });
  } catch (error) {
    return next(error);
  }
};

const getMyCart = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const cart = await cartService.getCartByUser(userId);

    // Hitung total belanjaan keseluruhan
    const grandTotal = cart.reduce(
      (acc, item) => acc + Number(item.subtotal),
      0,
    );

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil data keranjang",
      data: {
        items: cart,
        grand_total: grandTotal,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const updateQuantity = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { quantity } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({
        code: 400,
        message: "ID keranjang tidak valid",
      });
    }

    if (!quantity || isNaN(quantity) || quantity < 1) {
      return res.status(400).json({
        code: 400,
        message: "Jumlah (quantity) minimal harus 1",
      });
    }

    const updated = await cartService.updateCartQuantity(userId, id, quantity);

    if (!updated) {
      return res.status(404).json({
        code: 404,
        message: "Item keranjang tidak ditemukan",
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Berhasil memperbarui jumlah produk",
      data: updated,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteCartItem = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (isNaN(id)) {
      return res.status(400).json({
        code: 400,
        message: "ID keranjang tidak valid",
      });
    }

    const deleted = await cartService.removeFromCart(userId, id);

    if (!deleted) {
      return res.status(404).json({
        code: 404,
        message: "Item keranjang tidak ditemukan",
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Item berhasil dihapus dari keranjang",
      data: { id: deleted.id },
    });
  } catch (error) {
    return next(error);
  }
};

const clearCart = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const deletedItems = await cartService.clearAllCart(userId);

    return res.status(200).json({
      code: 200,
      message: "Seluruh isi keranjang berhasil dikosongkan",
      data: {
        deleted_count: deletedItems.length,
      },
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  addToCart,
  getMyCart,
  updateQuantity,
  deleteCartItem,
  clearCart,
};
