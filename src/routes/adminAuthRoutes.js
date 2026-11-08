const express = require("express");
const router = express.Router();
const adminAuthController = require("../controllers/adminAuthController");
const { verifyAdminToken } = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const { loginLimiter } = require("../middlewares/rateLimit");
const { loginBody } = require("../validation/authSchemas");

router.post(
  "/login",
  loginLimiter,
  validate({ body: loginBody }),
  adminAuthController.handleLogin,
);
router.get("/me", verifyAdminToken, adminAuthController.handleGetProfile);

module.exports = router;
