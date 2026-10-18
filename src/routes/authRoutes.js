const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { verifyUserToken } = require("../middlewares/authMiddleware");

router.post("/register", authController.handleRegister);
router.post("/login", authController.handleLogin);
router.get("/me", verifyUserToken, authController.handleGetProfile);

module.exports = router;