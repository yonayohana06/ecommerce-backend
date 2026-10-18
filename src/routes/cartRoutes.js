const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");
const { verifyUserToken } = require("../middlewares/authMiddleware");

router.post("/", verifyUserToken, cartController.addToCart);
router.get("/", verifyUserToken, cartController.getMyCart);
router.delete("/", verifyUserToken, cartController.clearCart);
router.put("/:id", verifyUserToken, cartController.updateQuantity);
router.delete("/:id", verifyUserToken, cartController.deleteCartItem);

module.exports = router;
