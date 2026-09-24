const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");
const { verifyAuthToken, authorize } = require("../middlewares/authMiddleware");
const upload = require("../middlewares/uploadMiddleware");

// Endpoint get summary untuk dashboard admin
router.get(
  "/admin/orders/summary",
  verifyAuthToken,
  authorize("admin"),
  paymentController.getAdminOrderSummary,
);

// Endpoint Admin Management get all orders data
router.get(
  "/admin/orders",
  verifyAuthToken,
  authorize("admin"),
  paymentController.getAdminOrders,
);

// Endpoint Detail Order Spesifik
router.get(
  "/admin/orders/:orderId",
  verifyAuthToken,
  authorize("admin"),
  paymentController.getAdminOrderDetail,
);

// Endpoint User: Submit Bukti Bayar (form-data dengan field 'proof_image')
router.post(
  "/orders/:orderId/pay",
  verifyAuthToken,
  upload.single("proof_image"),
  paymentController.uploadPaymentProof,
);

// Endpoint Admin: UBAH STATUS ORDER (misal: paid / cancelled)
router.patch(
  "/admin/orders/:orderId/status",
  verifyAuthToken,
  authorize("admin"),
  paymentController.changeOrderStatusByAdmin,
);

module.exports = router;
