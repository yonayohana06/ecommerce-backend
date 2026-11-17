const express = require("express");
const router = express.Router();
const adminAuthController = require("../controllers/adminAuthController");
const { verifyAdminToken } = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const {
  loginLimiter,
  refreshLimiter,
  passwordLimiter,
} = require("../middlewares/rateLimit");
const requireTrustedOrigin = require("../middlewares/requireTrustedOrigin");
const {
  loginBody,
  changePasswordBody,
} = require("../validation/authSchemas");

router.post(
  "/login",
  loginLimiter,
  validate({ body: loginBody }),
  adminAuthController.handleLogin,
);
router.post(
  "/refresh",
  requireTrustedOrigin,
  refreshLimiter,
  adminAuthController.handleRefresh,
);
router.post(
  "/logout",
  requireTrustedOrigin,
  adminAuthController.handleLogout,
);
router.get("/me", verifyAdminToken, adminAuthController.handleGetProfile);
router.put(
  "/password",
  verifyAdminToken,
  passwordLimiter,
  validate({ body: changePasswordBody }),
  adminAuthController.handleChangePassword,
);

module.exports = router;
