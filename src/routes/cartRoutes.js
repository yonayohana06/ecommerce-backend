const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");
const { verifyAuthToken } = require("../middlewares/authMiddleware");

router.post("/", verifyAuthToken, cartController.addToCart);
router.get("/", verifyAuthToken, cartController.getMyCart);
router.delete("/", verifyAuthToken, cartController.clearCart);
router.put("/:id", verifyAuthToken, cartController.updateQuantity);
router.delete("/:id", verifyAuthToken, cartController.deleteCartItem);

module.exports = router;
