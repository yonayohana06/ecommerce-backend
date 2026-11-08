const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const verifyPaymentSignature = require("../middlewares/verifySignature");
const { verifyUserToken } = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const { webhookLimiter } = require("../middlewares/rateLimit");
const {
  checkoutBody,
  listQuery,
  idParams,
  webhookBody,
} = require("../validation/orderSchemas");

// GET /api/orders (Ambil riwayat/daftar pesanan user)
router.get(
  "/",
  verifyUserToken,
  validate({ query: listQuery }),
  orderController.getUserOrders,
);

// GET /api/orders/:id (Ambil detail pesanan user)
router.get(
  "/:id",
  verifyUserToken,
  validate({ params: idParams }),
  orderController.getUserOrderDetail,
);

// POST /api/orders/checkout (Checkout belanjaan keranjang)
router.post(
  "/checkout",
  verifyUserToken,
  validate({ body: checkoutBody }),
  orderController.handleCheckout,
);

// POST /api/orders/webhook/payment (Webhook callback dari Payment Gateway)
router.post(
  "/webhook/payment",
  webhookLimiter,
  verifyPaymentSignature,
  validate({ body: webhookBody }),
  orderController.handlePaymentWebhook,
);

module.exports = router;
