const { pool } = require("../config/db");
const supabase = require("../config/supabase");
const ORDER_STATUS = require("../constants/orderStatus");

// Helper untuk membuat Signed URL dari nama file di Private Bucket
const generateSignedUrl = async (filePath) => {
  if (!filePath) return null;

  // Validasi jika string sudah berupa URL utuh (antisipasi data lama)
  if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
    return filePath;
  }

  // Buat Signed URL berlaku selama 60 menit (3600 detik)
  const { data, error } = await supabase.storage
    .from("payment-proofs")
    .createSignedUrl(filePath, 3600);

  if (error || !data) {
    console.error("Error generating signed URL:", error);
    return null;
  }

  return data.signedUrl;
};

// User Upload Bukti Transfer
const submitPaymentProof = async (userId, orderId, file) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Cek apakah pesanan ada, milik user yang sesuai, dan statusnya masih PENDING
    const orderCheck = await client.query(
      `SELECT id, status FROM orders 
       WHERE id = $1 AND user_id = $2 AND status = $3::order_status 
       FOR UPDATE`,
      [orderId, userId, ORDER_STATUS.PENDING],
    );

    if (orderCheck.rows.length === 0) {
      const error = new Error(
        "Pesanan tidak ditemukan atau sudah tidak dalam status PENDING",
      );
      error.statusCode = 400;
      throw error;
    }

    // Upload file bukti bayar ke Supabase Storage
    const fileExt = file.originalname.split(".").pop();
    const fileName = `proof_${orderId}_${Date.now()}.${fileExt}`;

    const { error: storageError } = await supabase.storage
      .from("payment-proofs")
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (storageError) {
      throw new Error(
        `Gagal mengunggah file ke Storage: ${storageError.message}`,
      );
    }

    // Ambil URL (Public URL / simpan fileName jika pakai Private Bucket)
    // const { data: publicUrlData } = supabase.storage
    //   .from("payment-proofs")
    //   .getPublicUrl(fileName);

    // const proofUrl = publicUrlData.publicUrl;

    // Update status order menjadi 'PROCESSING' dan simpan bukti transfer
    const updateQuery = `
      UPDATE orders
      SET 
        status = 'PROCESSING'::order_status,
        payment_proof_url = $1,
        payment_submitted_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const result = await client.query(updateQuery, [fileName, orderId]);

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Admin Verifikasi Status Order
const updateOrderStatus = async (orderId, newStatus) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Ambil order & itemnya
    const orderQuery = await client.query(
      "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
      [orderId],
    );
    if (orderQuery.rows.length === 0) {
      const error = new Error("Pesanan tidak ditemukan");
      error.statusCode = 404;
      throw error;
    }

    const currentOrder = orderQuery.rows[0];
    const oldStatus = currentOrder.status;

    // Kategori Status
    const isNewStatusCancelled =
      newStatus === ORDER_STATUS.CANCELLED || newStatus === ORDER_STATUS.FAILED;
    const isOldStatusCancelled =
      oldStatus === ORDER_STATUS.CANCELLED || oldStatus === ORDER_STATUS.FAILED;

    // KASUS A: Pembatalan Baru (Aktif -> CANCELLED/FAILED) => Kembalikan Stok (+qty)
    if (isNewStatusCancelled && !isOldStatusCancelled) {
      const itemsQuery = await client.query(
        "SELECT product_id, quantity FROM order_items WHERE order_id = $1",
        [orderId],
      );

      for (const item of itemsQuery.rows) {
        await client.query(
          "UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2",
          [item.quantity, item.product_id],
        );
      }
    }

    // KASUS B: Revert Salah Tolak (CANCELLED/FAILED -> Aktif/PAID) => ambil Stok Kembali (-qty)
    if (!isNewStatusCancelled && isOldStatusCancelled) {
      const itemsQuery = await client.query(
        "SELECT product_id, quantity FROM order_items WHERE order_id = $1",
        [orderId],
      );

      // Cek ketersediaan semua stok sebelum diambil
      for (const item of itemsQuery.rows) {
        const productQuery = await client.query(
          "SELECT stock, name FROM products WHERE id = $1 FOR UPDATE",
          [item.product_id],
        );

        if (productQuery.rows.length === 0) {
          throw new Error(
            `Produk dengan ID ${item.product_id} sudah tidak ada`,
          );
        }

        const product = productQuery.rows[0];
        if (product.stock < item.quantity) {
          const error = new Error(
            `Gagal mengembalikan status. Stok untuk produk '${product.name}' tidak mencukupi (Sisa stok: ${product.stock}, dibutuhkan: ${item.quantity}).`,
          );
          error.statusCode = 400;
          throw error;
        }
      }

      // Ambil stok jika semua produk aman
      for (const item of itemsQuery.rows) {
        await client.query(
          "UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2",
          [item.quantity, item.product_id],
        );
      }
    }

    // Update status
    const updateResult = await client.query(
      "UPDATE orders SET status = $1::order_status, updated_at = NOW() WHERE id = $2 RETURNING *",
      [newStatus, orderId],
    );

    await client.query("COMMIT");
    const updatedOrder = updateResult.rows[0];
    if (updatedOrder.payment_proof_url) {
      updatedOrder.payment_proof_url = await generateSignedUrl(
        updatedOrder.payment_proof_url,
      );
    }
    return updatedOrder;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Admin Get All Orders (Filter & Pagination & Signed URL)
const getAllOrdersForAdmin = async ({
  status,
  search,
  page = 1,
  limit = 10,
}) => {
  // Sanitasi Input Page: Pastikan minimal 1 dan berupa angka positif
  const pageNum = Math.max(1, parseInt(page, 10) || 1);

  // Sanitasi Input Limit: Minimal 1, Default 10, dan MAKSIMAL 100
  const rawLimit = parseInt(limit, 10) || 10;
  const limitNum = Math.min(100, Math.max(1, rawLimit));
  const offset = (pageNum - 1) * limitNum;

  let queryValues = [];
  let whereClauses = [];

  if (status) {
    whereClauses.push(`o.status = $${queryValues.length + 1}::order_status`);
    queryValues.push(status);
  }

  if (search && search.trim() !== "") {
    const searchParam = `%${search.trim()}%`;
    whereClauses.push(
      `(CAST(o.id AS TEXT) ILIKE $${queryValues.length + 1} OR u.email ILIKE $${queryValues.length + 1})`,
    );
    queryValues.push(searchParam);
  }

  const whereString =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  // Query Data Order + Info User
  const ordersQuery = `
    SELECT 
      o.id AS order_id, o.user_id, u.email, u.name as user_name,
      o.total_amount, o.status, o.shipping_address,
      o.payment_proof_url, o.payment_submitted_at,
      o.created_at, o.updated_at
    FROM orders o
    JOIN users u ON o.user_id = u.id
    ${whereString}
    ORDER BY o.created_at DESC
    LIMIT $${queryValues.length + 1} OFFSET $${queryValues.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*) 
    FROM orders o 
    JOIN users u ON o.user_id = u.id 
    ${whereString}
  `;

  const [ordersResult, countResult] = await Promise.all([
    pool.query(ordersQuery, [...queryValues, limitNum, offset]),
    pool.query(countQuery, queryValues),
  ]);

  // Convert payment_proof_url dari path menjadi Signed URL secara paralel
  const orders = await Promise.all(
    ordersResult.rows.map(async (order) => {
      if (order.payment_proof_url) {
        order.payment_proof_url = await generateSignedUrl(
          order.payment_proof_url,
        );
      }
      return order;
    }),
  );

  const totalItems = parseInt(countResult.rows[0].count, 10);
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

// Endpint get detail order for admin
const getOrderDetailForAdmin = async (orderId) => {
  // Query Data Order Utama + User
  const orderQuery = `
    SELECT 
      o.id, o.user_id, u.email, u.name as user_name, u.phone_number,
      o.total_amount, o.status, o.shipping_address,
      o.payment_proof_url, o.payment_submitted_at,
      o.created_at, o.updated_at
    FROM orders o
    JOIN users u ON o.user_id = u.id
    WHERE o.id = $1;
  `;

  // Query Item Produk yang Dibeli
  const itemsQuery = `
    SELECT 
      oi.id as order_item_id,
      oi.product_id,
      p.name as product_name,
      p.image_url as product_image,
      oi.quantity,
      oi.price_at_purchase,
      (oi.quantity * oi.price_at_purchase) as subtotal
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = $1;
  `;

  const [orderResult, itemsResult] = await Promise.all([
    pool.query(orderQuery, [orderId]),
    pool.query(itemsQuery, [orderId]),
  ]);

  if (orderResult.rows.length === 0) {
    const error = new Error("Pesanan tidak ditemukan");
    error.statusCode = 404;
    throw error;
  }

  const order = orderResult.rows[0];

  // Convert payment_proof_url menjadi Signed URL jika ada
  if (order.payment_proof_url) {
    order.payment_proof_url = await generateSignedUrl(order.payment_proof_url);
  }

  // Format harga subtotal ke float
  const items = itemsResult.rows.map((item) => ({
    ...item,
    price_at_purchase: parseFloat(item.price_at_purchase),
    subtotal: parseFloat(item.subtotal),
  }));

  return {
    ...order,
    total_amount: parseFloat(order.total_amount),
    items,
  };
};

const getOrderSummaryForAdmin = async () => {
  // Query agregasi untuk menghitung jumlah order per status & total omset
  // Catatan: Omset hanya dihitung dari transaksi yang bernilai valid (PAID, SHIPPED, COMPLETED)
  const summaryQuery = `
    SELECT
      COUNT(*) AS total_orders,
      COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
      COUNT(*) FILTER (WHERE status = 'PROCESSING') AS processing,
      COUNT(*) FILTER (WHERE status = 'PAID') AS paid,
      COUNT(*) FILTER (WHERE status = 'SHIPPED') AS shipped,
      COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
      COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
      COUNT(*) FILTER (WHERE status = 'FAILED') AS failed,
      COALESCE(SUM(total_amount) FILTER (WHERE status IN ('PAID', 'SHIPPED', 'COMPLETED')), 0) AS total_revenue
    FROM orders;
  `;

  const result = await pool.query(summaryQuery);
  const row = result.rows[0];

  return {
    totalOrders: parseInt(row.total_orders, 10),
    totalRevenue: parseFloat(row.total_revenue),
    ordersByStatus: {
      PENDING: parseInt(row.pending, 10),
      PROCESSING: parseInt(row.processing, 10),
      PAID: parseInt(row.paid, 10),
      SHIPPED: parseInt(row.shipped, 10),
      COMPLETED: parseInt(row.completed, 10),
      CANCELLED: parseInt(row.cancelled, 10),
      FAILED: parseInt(row.failed, 10),
    },
  };
};

module.exports = {
  submitPaymentProof,
  updateOrderStatus,
  getAllOrdersForAdmin,
  getOrderDetailForAdmin,
  getOrderSummaryForAdmin,
};
