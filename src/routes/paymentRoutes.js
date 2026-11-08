const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");
const {
  verifyAdminToken,
  verifyUserToken,
} = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const upload = require("../middlewares/uploadMiddleware");
const {
  orderIdParams,
  statusBody,
  adminOrdersQuery,
} = require("../validation/paymentSchemas");

// Endpoint get summary untuk dashboard admin
router.get(
  "/admin/orders/summary",
  verifyAdminToken,
  paymentController.getAdminOrderSummary,
);

// Endpoint Admin Management get all orders data
router.get(
  "/admin/orders",
  verifyAdminToken,
  validate({ query: adminOrdersQuery }),
  paymentController.getAdminOrders,
);

// Endpoint Detail Order Spesifik
router.get(
  "/admin/orders/:orderId",
  verifyAdminToken,
  validate({ params: orderIdParams }),
  paymentController.getAdminOrderDetail,
);

// Endpoint User: Submit Bukti Bayar (form-data dengan field 'proof_image')
router.post(
  "/orders/:orderId/pay",
  verifyUserToken,
  validate({ params: orderIdParams }),
  upload.single("proof_image"),
  paymentController.uploadPaymentProof,
);

// Endpoint Admin: UBAH STATUS ORDER (misal: paid / cancelled)
router.patch(
  "/admin/orders/:orderId/status",
  verifyAdminToken,
  validate({ params: orderIdParams, body: statusBody }),
  paymentController.changeOrderStatusByAdmin,
);

module.exports = router;
