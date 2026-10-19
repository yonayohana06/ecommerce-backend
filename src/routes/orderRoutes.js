const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const verifyPaymentSignature = require("../middlewares/verifySignature");
const { verifyUserToken } = require("../middlewares/authMiddleware");

// GET /api/orders (Ambil riwayat/daftar pesanan user)
router.get("/", verifyUserToken, orderController.getUserOrders);

// GET /api/orders/:id (Ambil detail pesanan user)
router.get("/:id", verifyUserToken, orderController.getUserOrderDetail);

// POST /api/orders/checkout (Checkout belanjaan keranjang)
router.post("/checkout", verifyUserToken, orderController.handleCheckout);

// POST /api/orders/webhook/payment (Webhook callback dari Payment Gateway)
router.post(
  "/webhook/payment",
  verifyPaymentSignature,
  orderController.handlePaymentWebhook,
);

module.exports = router;
