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
    return res.status(400).json({
      code: 400,
      message: error.message,
    });
  }
};

module.exports = {
  handleCheckout,
  handlePaymentWebhook,
};
