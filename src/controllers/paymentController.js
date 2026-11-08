const paymentService = require("../services/paymentService");
const ORDER_STATUS = require("../constants/orderStatus");

const uploadPaymentProof = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { orderId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        code: 400,
        message: "File bukti pembayaran (image) wajib diunggah",
      });
    }

    const updatedOrder = await paymentService.submitPaymentProof(
      userId,
      orderId,
      file,
    );

    return res.status(200).json({
      code: 200,
      message: "Bukti pembayaran berhasil diunggah. Menunggu konfirmasi admin.",
      data: updatedOrder,
    });
  } catch (error) {
    return next(error);
  }
};

const changeOrderStatusByAdmin = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = Object.values(ORDER_STATUS);
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        code: 400,
        message: `Status tidak valid. Pilihan: ${validStatuses.join(", ")}`,
      });
    }

    const updatedOrder = await paymentService.updateOrderStatus(
      orderId,
      status,
    );

    return res.status(200).json({
      code: 200,
      message: `Status pesanan berhasil diubah menjadi '${status}'`,
      data: updatedOrder,
    });
  } catch (error) {
    return next(error);
  }
};

// Admin Get List All Orders
const getAdminOrders = async (req, res, next) => {
  try {
    const { status, search, page, limit } = req.query;

    if (status && !Object.values(ORDER_STATUS).includes(status)) {
      return res.status(400).json({
        code: 400,
        message: `Filter status tidak valid. Pilihan: ${Object.values(ORDER_STATUS).join(", ")}`,
      });
    }

    const result = await paymentService.getAllOrdersForAdmin({
      status,
      search,
      page,
      limit,
    });

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil daftar pesanan admin",
      data: result.orders,
      pagination: result.pagination,
    });
  } catch (error) {
    return next(error);
  }
};

const getAdminOrderDetail = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const orderDetail = await paymentService.getOrderDetailForAdmin(orderId);

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil detail pesanan",
      data: orderDetail,
    });
  } catch (error) {
    return next(error);
  }
};

const getAdminOrderSummary = async (req, res, next) => {
  try {
    const summary = await paymentService.getOrderSummaryForAdmin();

    return res.status(200).json({
      code: 200,
      message: "Berhasil mengambil ringkasan statistik pesanan",
      data: summary,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  uploadPaymentProof,
  changeOrderStatusByAdmin,
  getAdminOrders,
  getAdminOrderDetail,
  getAdminOrderSummary,
};
