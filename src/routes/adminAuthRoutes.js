const express = require("express");
const router = express.Router();
const adminAuthController = require("../controllers/adminAuthController");
const { verifyAdminToken } = require("../middlewares/authMiddleware");

router.post("/login", adminAuthController.handleLogin);
router.get("/me", verifyAdminToken, adminAuthController.handleGetProfile);

module.exports = router;
