const orderService = require("../services/orderService");

const handleCheckout = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { shipping_address } = req.body;

    if (!shipping_address || shipping_address.trim() === "") {
      return res.status(400).json({
        code: 400,
        message: "Alamat pengiriman (shipping_address) wajib diisi",
      });
    }

    const order = await orderService.checkout(userId, shipping_address);

    return res.status(201).json({
      code: 201,
      message: "Checkout berhasil. Pesanan Anda telah dibuat.",
      data: order,
    });
  } catch (error) {
    console.error("Error during checkout:", error);

    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      code: statusCode,
      message:
        error.message ||
        "Terjadi kesalahan pada server saat transaksi checkout.",
    });
  }
};

const getUserOrders = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, page, limit } = req.query;

    const result = await orderService.getUserOrders({
      userId,
      status,
      page,
      limit,
    });

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil daftar pesanan",
      data: result.orders,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("Error fetching user orders:", error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      code: statusCode,
      message: error.message || "Internal Server Error",
    });
  }
};

const getUserOrderDetail = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (isNaN(id)) {
      return res.status(400).json({
        code: 400,
        message: "ID pesanan tidak valid",
      });
    }

    const order = await orderService.getUserOrderDetail({
      userId,
      orderId: id,
    });

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil detail pesanan",
      data: order,
    });
  } catch (error) {
    console.error("Error fetching user order detail:", error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      code: statusCode,
      message: error.message || "Internal Server Error",
    });
  }
};

const handlePaymentWebhook = async (req, res) => {
  try {
    const { order_id, transaction_status } = req.body;

    if (!order_id || !transaction_status) {
      return res.status(400).json({
        code: 400,
        message:
          "Payload tidak valid. order_id dan transaction_status wajib disertakan.",
      });
    }

    // Mapping status dari payment gateway ke status internal database
    let newStatus;
    if (
      ["capture", "settlement", "success", "PAID"].includes(transaction_status)
    ) {
      newStatus = "PAID";
    } else if (["cancel", "deny", "expire"].includes(transaction_status)) {
      newStatus = "CANCELLED";
    } else {
      newStatus = "PENDING";
    }

    const updatedOrder = await orderService.updateOrderStatus({
      orderId: order_id,
      targetStatus: newStatus,
    });

    // Payment gateway selalu mengharapkan HTTP 200 OK agar tidak mengirim ulang webhook
    return res.status(200).json({
      code: 200,
      message: "Status pembayaran berhasil diproses",
      data: updatedOrder,
    });
  } catch (error) {
    console.error("Webhook error:", error.message);
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      code: statusCode,
      message: error.message,
    });
  }
};

module.exports = {
  handleCheckout,
  getUserOrders,
  getUserOrderDetail,
  handlePaymentWebhook,
};
