const crypto = require('crypto');
require('dotenv').config();

const verifyPaymentSignature = (req, res, next) => {
    const { order_id, status_code, gross_amount, signature_key } = req.body;
    const serverKey = process.env.PAYMENT_SERVER_KEY;

    if (!order_id || !status_code || !gross_amount || !signature_key) {
        return res.status(400).json({
            code: 400,
            message: 'Parameter signature tidak lengkap',
        });
    }

    // 1. Gabungkan string sesuai rumus standar gateway
    const rawString = `${order_id}${status_code}${gross_amount}${serverKey}`;

    // 2. Buat hash SHA-512
    const expectedSignature = crypto
        .createHash('sha512')
        .update(rawString)
        .digest('hex');

    // 3. Bandingkan signature dari request dengan kalkulasi lokal
    if (signature_key !== expectedSignature) {
        console.warn(`[SECURITY ALERT] Signature tidak valid untuk Order ${order_id}`);
        return res.status(403).json({
            code: 403,
            message: 'Forbidden: Invalid signature key',
        });
    }

    // Lolos verifikasi, lanjut ke controller
    next();
};

module.exports = verifyPaymentSignature;