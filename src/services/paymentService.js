const { pool } = require("../config/db");
const { serializeOrder, toNumber } = require("../utils/serializers");
const supabase = require("../config/supabase");
const ORDER_STATUS = require("../constants/orderStatus");
const orderStatusService = require("./orderStatusService");
const { signedUrlCache } = require("../utils/signedUrlCache");

const SIGNED_URL_EXPIRES_IN = 3600; // 60 menit

// Helper untuk membuat Signed URL dari satu nama file di Private Bucket.
// Hasil dicache di memori dengan TTL lebih pendek dari masa berlaku signed URL
// (3600 detik) sehingga klien tidak menerima URL yang sudah kedaluwarsa.
const generateSignedUrl = async (filePath) => {
  if (!filePath) return null;

  // Validasi jika string sudah berupa URL utuh (antisipasi data lama)
  if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
    return filePath;
  }

  const cached = signedUrlCache.get(filePath);
  if (cached) {
    return cached;
  }

  const urls = await generateSignedUrls([filePath]);
  return urls.get(filePath) || null;
};

// Buat Signed URL untuk banyak file dalam satu panggilan storage
// (createSignedUrls batch) untuk menghindari pola N+1 pada daftar order.
const generateSignedUrls = async (filePaths) => {
  const result = new Map();
  const uncached = [];

  for (const filePath of filePaths) {
    if (!filePath) continue;

    // URL utuh tidak perlu ditandatangani dan tidak dicache.
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
      result.set(filePath, filePath);
      continue;
    }

    const cached = signedUrlCache.get(filePath);
    if (cached) {
      result.set(filePath, cached);
      continue;
    }

    uncached.push(filePath);
  }

  if (uncached.length > 0) {
    const { data, error } = await supabase.storage
      .from("payment-proofs")
      .createSignedUrls(uncached, SIGNED_URL_EXPIRES_IN);

    if (error || !Array.isArray(data)) {
      console.error("Error generating signed URLs:", error);
      return result;
    }

    for (const item of data) {
      if (!item || !item.path) continue;
      const signedUrl = item.signedURL || item.signedUrl || null;
      if (signedUrl) {
        signedUrlCache.set(item.path, signedUrl);
        result.set(item.path, signedUrl);
      }
    }
  }

  return result;
};

// Hapus seluruh cache signed URL (digunakan uji coba dan admin saat bukti
// diganti, sehingga URL baru segera dihasilkan).
const clearSignedUrlCache = () => {
  signedUrlCache.clear();
};

// User Upload Bukti Transfer
const submitPaymentProof = async (userId, orderId, file) => {
  // Pre-check agar file tidak diunggah untuk pesanan yang jelas tidak valid.
  const orderCheck = await pool.query(
    `SELECT id, status FROM orders WHERE id = $1 AND user_id = $2`,
    [orderId, userId],
  );

  if (
    orderCheck.rows.length === 0 ||
    orderCheck.rows[0].status !== ORDER_STATUS.PENDING
  ) {
    const error = new Error(
      "Pesanan tidak ditemukan atau sudah tidak dalam status PENDING",
    );
    error.statusCode = 400;
    throw error;
  }

  // Gunakan ekstensi dari MIME yang sudah divalidasi magic bytes,
  // bukan dari originalname yang dikendalikan client.
  const fileExt = file.extension;
  const contentType = file.detectedMime;

  if (!fileExt || !contentType) {
    const error = new Error("File bukti pembayaran tidak valid");
    error.statusCode = 400;
    throw error;
  }

  const fileName = `proof_${orderId}_${Date.now()}.${fileExt}`;

  const { error: storageError } = await supabase.storage
    .from("payment-proofs")
    .upload(fileName, file.buffer, {
      contentType,
      upsert: true,
    });

  if (storageError) {
    throw new Error(
      `Gagal mengunggah file ke Storage: ${storageError.message}`,
    );
  }

  try {
    // Perubahan status tetap melalui service transaksional yang sama.
    const result = await orderStatusService.changeOrderStatus({
      orderId,
      newStatus: ORDER_STATUS.PROCESSING,
      source: "user",
      userId,
      requiredStatus: ORDER_STATUS.PENDING,
      paymentProofUrl: fileName,
    });

    return serializeOrder(result.order);
  } catch (error) {
    // Jangan tinggalkan file orphan jika update database gagal.
    const { error: removeError } = await supabase.storage
      .from("payment-proofs")
      .remove([fileName]);

    if (removeError) {
      console.error(
        `Gagal menghapus file bukti bayar orphan '${fileName}':`,
        removeError.message,
      );
    }

    throw error;
  }
};

// Admin Verifikasi Status Order
const updateOrderStatus = async (orderId, newStatus) => {
  const { order } = await orderStatusService.changeOrderStatus({
    orderId,
    newStatus,
    source: "admin",
  });

  const updatedOrder = { ...order };

  if (updatedOrder.payment_proof_url) {
    updatedOrder.payment_proof_url = await generateSignedUrl(
      updatedOrder.payment_proof_url,
    );
  }

  return serializeOrder(updatedOrder);
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

  // Convert payment_proof_url dari path menjadi Signed URL secara batch
  // (satu panggilan createSignedUrls untuk semua order dalam halaman).
  const proofUrls = ordersResult.rows
    .map((order) => order.payment_proof_url)
    .filter(Boolean);
  const signedProofUrls = await generateSignedUrls(proofUrls);

  const orders = ordersResult.rows.map((order) => {
    if (order.payment_proof_url) {
      order.payment_proof_url =
        signedProofUrls.get(order.payment_proof_url) || null;
    }
    return serializeOrder(order);
  });

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

  return serializeOrder({
    ...order,
    items: itemsResult.rows,
  });
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
    totalRevenue: toNumber(row.total_revenue),
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
  generateSignedUrl,
  generateSignedUrls,
  clearSignedUrlCache,
  submitPaymentProof,
  updateOrderStatus,
  getAllOrdersForAdmin,
  getOrderDetailForAdmin,
  getOrderSummaryForAdmin,
};
