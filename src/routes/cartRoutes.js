const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");
const { verifyUserToken } = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const {
  addBody,
  updateBody,
  idParams,
} = require("../validation/cartSchemas");

router.post(
  "/",
  verifyUserToken,
  validate({ body: addBody }),
  cartController.addToCart,
);
router.get("/", verifyUserToken, cartController.getMyCart);
router.delete("/", verifyUserToken, cartController.clearCart);
router.put(
  "/:id",
  verifyUserToken,
  validate({ params: idParams, body: updateBody }),
  cartController.updateQuantity,
);
router.delete(
  "/:id",
  verifyUserToken,
  validate({ params: idParams }),
  cartController.deleteCartItem,
);

module.exports = router;
