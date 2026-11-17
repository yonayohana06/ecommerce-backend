const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { verifyUserToken } = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const {
  loginLimiter,
  registerLimiter,
  refreshLimiter,
  passwordLimiter,
} = require("../middlewares/rateLimit");
const requireTrustedOrigin = require("../middlewares/requireTrustedOrigin");
const {
  registerBody,
  loginBody,
  changePasswordBody,
} = require("../validation/authSchemas");

router.post(
  "/register",
  registerLimiter,
  validate({ body: registerBody }),
  authController.handleRegister,
);
router.post(
  "/login",
  loginLimiter,
  validate({ body: loginBody }),
  authController.handleLogin,
);
router.post(
  "/refresh",
  requireTrustedOrigin,
  refreshLimiter,
  authController.handleRefresh,
);
router.post(
  "/logout",
  requireTrustedOrigin,
  authController.handleLogout,
);
router.get("/me", verifyUserToken, authController.handleGetProfile);
router.put(
  "/password",
  verifyUserToken,
  passwordLimiter,
  validate({ body: changePasswordBody }),
  authController.handleChangePassword,
);

module.exports = router;
