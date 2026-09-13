const cartService = require("../services/cartService");

const addToCart = async (req, res) => {
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
    console.error("Error addToCart:", error);
    return res.status(500).json({
      code: 500,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getMyCart = async (req, res) => {
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
    console.error("Error getMyCart:", error);
    return res.status(500).json({
      code: 500,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const updateQuantity = async (req, res) => {
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
    console.error("Error updating cart quantity:", error);

    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      code: statusCode,
      message: error.message || "Internal Server Error",
    });
  }
};

const deleteCartItem = async (req, res) => {
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
    console.error("Error deleteCartItem:", error);
    return res.status(500).json({
      code: 500,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const clearCart = async (req, res) => {
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
    console.error("Error clearing cart:", error);
    return res.status(500).json({
      code: 500,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports = {
  addToCart,
  getMyCart,
  updateQuantity,
  deleteCartItem,
  clearCart,
};
