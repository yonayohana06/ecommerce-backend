const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { verifyUserToken } = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const { loginLimiter, registerLimiter } = require("../middlewares/rateLimit");
const { registerBody, loginBody } = require("../validation/authSchemas");

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
router.get("/me", verifyUserToken, authController.handleGetProfile);

module.exports = router;
