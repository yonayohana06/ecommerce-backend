const { pool } = require("../config/db");
const ORDER_STATUS = require("../constants/orderStatus");

// Transisi yang diizinkan. Revert dari CANCELLED/FAILED ke PAID dibutuhkan
// agar stok bisa dipotong kembali saat admin membatalkan pembatalan.
const TRANSITIONS = Object.freeze({
  [ORDER_STATUS.PENDING]: [
    ORDER_STATUS.PROCESSING,
    ORDER_STATUS.PAID,
    ORDER_STATUS.CANCELLED,
    ORDER_STATUS.FAILED,
  ],
  [ORDER_STATUS.PROCESSING]: [
    ORDER_STATUS.PAID,
    ORDER_STATUS.CANCELLED,
    ORDER_STATUS.FAILED,
  ],
  [ORDER_STATUS.PAID]: [ORDER_STATUS.SHIPPED],
  [ORDER_STATUS.SHIPPED]: [ORDER_STATUS.COMPLETED],
  [ORDER_STATUS.COMPLETED]: [],
  [ORDER_STATUS.CANCELLED]: [ORDER_STATUS.PAID],
  [ORDER_STATUS.FAILED]: [ORDER_STATUS.PAID],
});

const TRANSACTION_STATUS_MAP = Object.freeze({
  capture: ORDER_STATUS.PAID,
  settlement: ORDER_STATUS.PAID,
  success: ORDER_STATUS.PAID,
  paid: ORDER_STATUS.PAID,
  pending: ORDER_STATUS.PENDING,
  cancel: ORDER_STATUS.CANCELLED,
  deny: ORDER_STATUS.CANCELLED,
  expire: ORDER_STATUS.CANCELLED,
  failure: ORDER_STATUS.FAILED,
  failed: ORDER_STATUS.FAILED,
});

const CANCELLED_STATUSES = new Set([
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.FAILED,
]);

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const assertValidTransition = (currentStatus, newStatus) => {
  const validStatuses = Object.values(ORDER_STATUS);

  if (!validStatuses.includes(newStatus)) {
    throw createHttpError(
      `Status tidak valid. Pilihan: ${validStatuses.join(", ")}`,
      400,
    );
  }

  if (currentStatus === newStatus) {
    return false;
  }

  const allowedTransitions = TRANSITIONS[currentStatus] || [];

  if (!allowedTransitions.includes(newStatus)) {
    throw createHttpError(
      `Transisi status tidak valid: ${currentStatus} -> ${newStatus}`,
      400,
    );
  }

  return true;
};

const mapTransactionStatus = (transactionStatus) => {
  const normalized = String(transactionStatus ?? "")
    .trim()
    .toLowerCase();
  const mappedStatus = TRANSACTION_STATUS_MAP[normalized];

  if (!mappedStatus) {
    throw createHttpError(
      `transaction_status tidak dikenal: ${transactionStatus || "(kosong)"}`,
      400,
    );
  }

  return mappedStatus;
};

const validateGrossAmount = (order, grossAmount) => {
  if (grossAmount === undefined || grossAmount === null || grossAmount === "") {
    return;
  }

  const expectedAmount = Number(order.total_amount);
  const receivedAmount = Number(grossAmount);

  if (!Number.isFinite(receivedAmount) || receivedAmount !== expectedAmount) {
    throw createHttpError(
      `Nominal pembayaran tidak cocok. Diharapkan ${expectedAmount}, diterima ${grossAmount}`,
      400,
    );
  }
};

const getOrderQuantities = async (client, orderId) => {
  const result = await client.query(
    `SELECT product_id, quantity
     FROM order_items
     WHERE order_id = $1
     ORDER BY product_id`,
    [orderId],
  );

  const quantities = new Map();

  for (const item of result.rows) {
    const current = quantities.get(item.product_id) || 0;
    quantities.set(item.product_id, current + item.quantity);
  }

  return quantities;
};

const restockItems = async (client, quantities) => {
  for (const [productId, quantity] of quantities) {
    await client.query(
      `UPDATE products
       SET stock = stock + $1, updated_at = NOW()
       WHERE id = $2`,
      [quantity, productId],
    );
  }
};

const deductItemsStock = async (client, quantities) => {
  // Kunci semua produk dengan urutan ID yang konsisten untuk menghindari deadlock.
  const products = new Map();

  for (const [productId, quantity] of quantities) {
    const result = await client.query(
      "SELECT id, name, stock FROM products WHERE id = $1 FOR UPDATE",
      [productId],
    );

    if (result.rows.length === 0) {
      throw createHttpError(`Produk dengan ID ${productId} sudah tidak ada`, 400);
    }

    const product = result.rows[0];

    if (product.stock < quantity) {
      throw createHttpError(
        `Gagal mengembalikan status. Stok untuk produk '${product.name}' tidak mencukupi (Sisa stok: ${product.stock}, dibutuhkan: ${quantity}).`,
        400,
      );
    }

    products.set(productId, product);
  }

  for (const [productId, quantity] of quantities) {
    await client.query(
      `UPDATE products
       SET stock = stock - $1, updated_at = NOW()
       WHERE id = $2`,
      [quantity, productId],
    );
  }
};

const applyStatusChange = async (
  client,
  {
    orderId,
    newStatus,
    source = "unknown",
    grossAmount,
    userId,
    requiredStatus,
    paymentProofUrl,
  },
) => {
  const orderResult = await client.query(
    "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
    [orderId],
  );

  if (orderResult.rows.length === 0) {
    throw createHttpError("Pesanan tidak ditemukan", 404);
  }

  const order = orderResult.rows[0];

  if (userId !== undefined && String(order.user_id) !== String(userId)) {
    throw createHttpError("Pesanan tidak ditemukan", 404);
  }

  if (requiredStatus && order.status !== requiredStatus) {
    throw createHttpError(
      `Pesanan tidak dalam status ${requiredStatus} (status saat ini: ${order.status})`,
      400,
    );
  }

  validateGrossAmount(order, grossAmount);

  const changed = assertValidTransition(order.status, newStatus);

  if (!changed) {
    return {
      order,
      previousStatus: order.status,
      changed: false,
      source,
    };
  }

  const wasCancelled = CANCELLED_STATUSES.has(order.status);
  const willBeCancelled = CANCELLED_STATUSES.has(newStatus);

  if (wasCancelled !== willBeCancelled) {
    const quantities = await getOrderQuantities(client, orderId);

    if (willBeCancelled) {
      await restockItems(client, quantities);
    } else {
      await deductItemsStock(client, quantities);
    }
  }

  const setClauses = ["status = $1::order_status", "updated_at = NOW()"];
  const queryValues = [newStatus, orderId];

  if (paymentProofUrl) {
    setClauses.push(`payment_proof_url = $${queryValues.length + 1}`);
    queryValues.push(paymentProofUrl);
    setClauses.push("payment_submitted_at = NOW()");
  }

  const updateResult = await client.query(
    `UPDATE orders
     SET ${setClauses.join(", ")}
     WHERE id = $2
     RETURNING *`,
    queryValues,
  );

  return {
    order: updateResult.rows[0],
    previousStatus: order.status,
    changed: true,
    source,
  };
};

const changeOrderStatus = async (params) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await applyStatusChange(client, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  changeOrderStatus,
  applyStatusChange,
  assertValidTransition,
  mapTransactionStatus,
  TRANSITIONS,
};
