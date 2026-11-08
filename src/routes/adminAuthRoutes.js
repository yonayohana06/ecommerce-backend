const express = require("express");
const router = express.Router();
const adminAuthController = require("../controllers/adminAuthController");
const { verifyAdminToken } = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const { loginBody } = require("../validation/authSchemas");

router.post("/login", validate({ body: loginBody }), adminAuthController.handleLogin);
router.get("/me", verifyAdminToken, adminAuthController.handleGetProfile);

module.exports = router;
