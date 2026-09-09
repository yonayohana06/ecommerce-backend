const orderService = require('../services/orderService');

const handleCheckout = async (req, res) => {
    try {
        const { items, shipping_address } = req.body;
        const userId = req.userId;

        // Validasi input awal
        if (!shipping_address || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                code: 400,
                message: 'Data checkout tidak lengkap (items dan shipping_address wajib diisi).',
                data: null,
            });
        }

        const orderData = await orderService.checkoutOrder({
            userId,
            items,
            shippingAddress: shipping_address,
        });

        return res.status(201).json({
            code: 201,
            message: 'Checkout berhasil dibuat',
            data: orderData,
        });
    } catch (error) {
        // 400 Bad Request jika error berasal dari validasi bisnis (stok/produk)
        return res.status(400).json({
            code: 400,
            message: error.message,
            data: null,
        });
    }
};

const handlePaymentWebhook = async (req, res) => {
    try {
        const { order_id, transaction_status } = req.body;

        if (!order_id || !transaction_status) {
            return res.status(400).json({
                code: 400,
                message: 'Payload tidak valid. order_id dan transaction_status wajib disertakan.',
            });
        }

        // Mapping status dari payment gateway ke status internal database
        let newStatus;
        if (['capture', 'settlement', 'success', 'PAID'].includes(transaction_status)) {
            newStatus = 'PAID';
        } else if (['cancel', 'deny', 'expire'].includes(transaction_status)) {
            newStatus = 'CANCELLED';
        } else {
            newStatus = 'PENDING';
        }

        const updatedOrder = await orderService.updateOrderStatus({
            orderId: order_id,
            targetStatus: newStatus,
        });

        // Payment gateway selalu mengharapkan HTTP 200 OK agar tidak mengirim ulang webhook
        return res.status(200).json({
            code: 200,
            message: 'Status pembayaran berhasil diproses',
            data: updatedOrder,
        });
    } catch (error) {
        console.error('Webhook error:', error.message);
        return res.status(400).json({
            code: 400,
            message: error.message,
        });
    }
};

module.exports = {
    handleCheckout,
    handlePaymentWebhook,
};