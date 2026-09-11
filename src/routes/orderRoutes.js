const express = require('express');
const router = express.Router();
const db = require('../config/db');
const orderController = require('../controllers/orderController');
const verifyPaymentSignature = require('../middlewares/verifySignature');
const { verifyAuthToken } = require('../middlewares/authMiddleware');

// GET /api/orders/:id (Ambil detail order format JSON bersarang)
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const userId = 101; // Simulasi ID user yang sedang login

    const queryText = `
    SELECT 
        o.id AS order_id,
        o.status,
        o.total_amount,
        o.shipping_address,
        o.created_at,
        json_build_object(
            'id', u.id,
            'name', u.name,
            'email', u.email,
            'phone', u.phone_number
        ) AS customer,
        json_agg(
            json_build_object(
                'item_id', oi.id,
                'product_id', p.id,
                'product_name', p.name,
                'image_url', p.image_url,
                'quantity', oi.quantity,
                'price_at_purchase', oi.price_at_purchase,
                'subtotal', (oi.quantity * oi.price_at_purchase)
            )
        ) AS items
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN order_items oi ON o.id = oi.order_id
    JOIN products p ON oi.product_id = p.id
    WHERE o.id = $1 AND o.user_id = $2
    GROUP BY o.id, u.id;
  `;

    try {
        const result = await db.query(queryText, [id, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                code: 404,
                message: 'Order tidak ditemukan',
                data: null,
            });
        }

        return res.status(200).json({
            code: 200,
            message: 'Berhasil mengambil detail order',
            data: result.rows[0],
        });
    } catch (error) {
        console.error('Database Error:', error);
        return res.status(500).json({
            code: 500,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
});

// Route POST checkout
router.post('/checkout', verifyAuthToken, orderController.handleCheckout);

// Route POST webhook payment
router.post('/webhook/payment', verifyPaymentSignature, orderController.handlePaymentWebhook);

module.exports = router;