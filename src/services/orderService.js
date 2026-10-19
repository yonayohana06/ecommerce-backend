const { pool } = require("../config/db");
const ORDER_STATUS = require("../constants/orderStatus");
const { generateSignedUrl } = require("./paymentService");

const checkout = async (userId, shippingAddress) => {
  const client = await pool.connect();

  try {
    // 1. Mulai Transaksi Database
    await client.query("BEGIN");

    // 2. Ambil semua item di keranjang belanja user beserta detail produk terbaru
    const cartQuery = `
      SELECT 
        ci.product_id,
        ci.quantity,
        p.name AS product_name,
        p.price,
        p.stock,
        p.is_active
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = $1
      FOR UPDATE OF p; 
    `;
    // Note: FOR UPDATE OF p mengunci baris produk sementara agar tidak terjadi race-condition stok dari order lain

    const cartResult = await client.query(cartQuery, [userId]);
    const cartItems = cartResult.rows;

    if (cartItems.length === 0) {
      const error = new Error("Keranjang belanja Anda kosong");
      error.statusCode = 400;
      throw error;
    }

    // 3. Validasi Keaktifan Produk & Stok untuk Setiap Item
    let totalAmount = 0;
    for (const item of cartItems) {
      if (!item.is_active) {
        const error = new Error(
          `Produk '${item.product_name}' sudah tidak aktif/dihapus`,
        );
        error.statusCode = 400;
        throw error;
      }

      if (item.quantity > item.stock) {
        const error = new Error(
          `Stok produk '${item.product_name}' tidak mencukupi. Tersisa: ${item.stock}`,
        );
        error.statusCode = 400;
        throw error;
      }

      totalAmount += item.quantity * parseFloat(item.price);
    }

    // 4. Buat Baris Header Transaksi Baru di Tabel `orders`
    const createOrderQuery = `
      INSERT INTO orders (user_id, total_amount, status, shipping_address, created_at, updated_at)
      VALUES ($1, $2, 'PENDING'::order_status, $3, NOW(), NOW())
      RETURNING *;
    `;
    const orderResult = await client.query(createOrderQuery, [
      userId,
      totalAmount,
      shippingAddress,
    ]);
    const newOrder = orderResult.rows[0];

    // 5. Masukkan Detail Produk ke `order_items` & Potong Stok Produk
    for (const item of cartItems) {
      // a. Insert snapshot item ke order_items
      const createOrderItemQuery = `
        INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase, created_at)
        VALUES ($1, $2, $3, $4, NOW());
      `;
      await client.query(createOrderItemQuery, [
        newOrder.id,
        item.product_id,
        item.quantity,
        item.price, // Snapshot harga saat checkout dilakukan
      ]);

      // b. Deduct stock di tabel products
      const updateStockQuery = `
        UPDATE products
        SET stock = stock - $1, updated_at = NOW()
        WHERE id = $2;
      `;
      await client.query(updateStockQuery, [item.quantity, item.product_id]);
    }

    // 6. Kosongkan Keranjang Belanja User (`cart_items`)
    const clearCartQuery = `DELETE FROM cart_items WHERE user_id = $1;`;
    await client.query(clearCartQuery, [userId]);

    // 7. Simpan Seluruh Perubahan jika Tidak Ada Error
    await client.query("COMMIT");

    return newOrder;
  } catch (error) {
    // Jika ada error pada tahap apa pun, kembalikan kondisi database ke semula (Rollback)
    await client.query("ROLLBACK");
    throw error;
  } finally {
    // Selalu lepaskan koneksi client kembali ke pool
    client.release();
  }
};

// Ambil daftar pesanan milik user yang sedang login (dengan filter status & pagination)
const getUserOrders = async ({ userId, status, page = 1, limit = 10 }) => {
  // Sanitasi input pagination
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const rawLimit = parseInt(limit, 10) || 10;
  const limitNum = Math.min(100, Math.max(1, rawLimit));
  const offset = (pageNum - 1) * limitNum;

  const queryValues = [userId];
  const whereClauses = ["o.user_id = $1"];

  // Filter status jika disediakan
  if (status) {
    const validStatuses = Object.values(ORDER_STATUS);
    if (!validStatuses.includes(status)) {
      const error = new Error(
        `Filter status tidak valid. Pilihan status yang tersedia: ${validStatuses.join(", ")}`,
      );
      error.statusCode = 400;
      throw error;
    }
    queryValues.push(status);
    whereClauses.push(`o.status = $${queryValues.length}::order_status`);
  }

  const whereString = `WHERE ${whereClauses.join(" AND ")}`;

  // Query order header beserta preview items dan jumlah total item
  const ordersQuery = `
    SELECT 
      o.id AS order_id,
      o.user_id,
      o.total_amount,
      o.status,
      o.shipping_address,
      o.payment_proof_url,
      o.payment_submitted_at,
      o.created_at,
      o.updated_at,
      COUNT(oi.id)::int AS total_items,
      COALESCE(SUM(oi.quantity), 0)::int AS total_quantity,
      COALESCE(
        json_agg(
          json_build_object(
            'order_item_id', oi.id,
            'product_id', p.id,
            'product_name', p.name,
            'product_image', p.image_url,
            'quantity', oi.quantity,
            'price_at_purchase', oi.price_at_purchase,
            'subtotal', (oi.quantity * oi.price_at_purchase)
          )
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN products p ON oi.product_id = p.id
    ${whereString}
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT $${queryValues.length + 1} OFFSET $${queryValues.length + 2};
  `;

  const countQuery = `
    SELECT COUNT(*) 
    FROM orders o 
    ${whereString};
  `;

  const [ordersResult, countResult] = await Promise.all([
    pool.query(ordersQuery, [...queryValues, limitNum, offset]),
    pool.query(countQuery, queryValues),
  ]);

  // Generate Signed URL untuk payment_proof_url dan format angka
  const orders = await Promise.all(
    ordersResult.rows.map(async (order) => {
      let signedProofUrl = order.payment_proof_url;
      if (order.payment_proof_url) {
        signedProofUrl = await generateSignedUrl(order.payment_proof_url);
      }
      return {
        ...order,
        payment_proof_url: signedProofUrl,
        total_amount: parseFloat(order.total_amount),
        items: (order.items || []).map((item) => ({
          ...item,
          price_at_purchase: parseFloat(item.price_at_purchase),
          subtotal: parseFloat(item.subtotal),
        })),
      };
    }),
  );

  const totalItems = countResult.rows[0]?.count
    ? parseInt(countResult.rows[0].count, 10)
    : 0;
  const totalPages = Math.ceil(totalItems / limitNum) || 1;
  const hasPreviousPage = pageNum > 1;
  const hasNextPage = pageNum < totalPages;

  return {
    orders,
    pagination: {
      currentPage: pageNum,
      limit: limitNum,
      totalItems,
      totalPages,
      hasPreviousPage,
      hasNextPage,
    },
  };
};

// Ambil detail spesifik pesanan milik user
const getUserOrderDetail = async ({ userId, orderId }) => {
  const orderQuery = `
    SELECT 
      o.id,
      o.user_id,
      o.total_amount,
      o.status,
      o.shipping_address,
      o.payment_proof_url,
      o.payment_submitted_at,
      o.created_at,
      o.updated_at
    FROM orders o
    WHERE o.id = $1 AND o.user_id = $2;
  `;

  const itemsQuery = `
    SELECT 
      oi.id AS order_item_id,
      oi.product_id,
      p.name AS product_name,
      p.image_url AS product_image,
      oi.quantity,
      oi.price_at_purchase,
      (oi.quantity * oi.price_at_purchase) AS subtotal
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = $1;
  `;

  const [orderResult, itemsResult] = await Promise.all([
    pool.query(orderQuery, [orderId, userId]),
    pool.query(itemsQuery, [orderId]),
  ]);

  if (orderResult.rows.length === 0) {
    const error = new Error("Pesanan tidak ditemukan");
    error.statusCode = 404;
    throw error;
  }

  const order = orderResult.rows[0];

  let signedProofUrl = order.payment_proof_url;
  if (order.payment_proof_url) {
    signedProofUrl = await generateSignedUrl(order.payment_proof_url);
  }

  const items = itemsResult.rows.map((item) => ({
    ...item,
    price_at_purchase: parseFloat(item.price_at_purchase),
    subtotal: parseFloat(item.subtotal),
  }));

  return {
    ...order,
    payment_proof_url: signedProofUrl,
    total_amount: parseFloat(order.total_amount),
    items,
  };
};

// Update status pesanan (digunakan untuk webhook payment gateway)
const updateOrderStatus = async ({ orderId, targetStatus }) => {
  const query = `
    UPDATE orders 
    SET status = $1::order_status, updated_at = NOW() 
    WHERE id = $2 AND status != $1::order_status
    RETURNING id, user_id, status, total_amount;
  `;

  const result = await pool.query(query, [targetStatus, orderId]);

  if (result.rows.length === 0) {
    const checkOrder = await pool.query(
      "SELECT id, status FROM orders WHERE id = $1",
      [orderId],
    );
    if (checkOrder.rows.length === 0) {
      const error = new Error(`Order ID ${orderId} tidak ditemukan.`);
      error.statusCode = 404;
      throw error;
    }
    return { ...checkOrder.rows[0], already_processed: true };
  }

  return { ...result.rows[0], already_processed: false };
};

module.exports = {
  checkout,
  getUserOrders,
  getUserOrderDetail,
  updateOrderStatus,
};
