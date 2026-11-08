const db = require("../config/db");
const { serializeCartItem } = require("../utils/serializers");

const createServiceError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// Tambah ke keranjang (Upsert: Insert jika belum ada, Update quantity jika sudah ada)
// Produk wajib aktif dan total quantity tidak boleh melebihi stok.
const addToCart = async (userId, productId, quantity) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const productResult = await client.query(
      "SELECT id, name, stock, is_active FROM products WHERE id = $1 FOR UPDATE;",
      [productId],
    );

    if (productResult.rows.length === 0) {
      throw createServiceError("Produk tidak ditemukan", 404);
    }

    const product = productResult.rows[0];

    if (!product.is_active) {
      throw createServiceError(
        `Produk '${product.name}' sudah tidak aktif`,
        400,
      );
    }

    const existingResult = await client.query(
      `SELECT quantity FROM cart_items
       WHERE user_id = $1 AND product_id = $2
       FOR UPDATE;`,
      [userId, productId],
    );

    const existingQuantity = existingResult.rows[0]?.quantity ?? 0;
    const newQuantity = existingQuantity + quantity;

    if (newQuantity > product.stock) {
      throw createServiceError(
        `Stok tidak mencukupi. Stok '${product.name}' tersisa ${product.stock}`,
        400,
      );
    }

    const query = `
      INSERT INTO cart_items (user_id, product_id, quantity, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, product_id)
      DO UPDATE SET
        quantity = cart_items.quantity + EXCLUDED.quantity,
        updated_at = NOW()
      RETURNING *;
    `;
    const result = await client.query(query, [userId, productId, quantity]);

    await client.query("COMMIT");

    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Ambil isi keranjang user beserta detail produknya.
// Item nonaktif tetap ditampilkan agar user bisa menghapusnya, ditandai is_available=false.
const getCartByUser = async (userId) => {
  const query = `
    SELECT 
      ci.id AS cart_item_id,
      ci.product_id,
      p.name AS product_name,
      p.price,
      p.image_url,
      ci.quantity,
      p.stock,
      p.is_active,
      (p.is_active AND p.stock >= ci.quantity) AS is_available,
      (p.price * ci.quantity) AS subtotal
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.user_id = $1
    ORDER BY ci.created_at DESC;
  `;
  const result = await db.query(query, [userId]);
  return result.rows.map(serializeCartItem);
};

// Update quantity item spesifik di keranjang
const updateCartQuantity = async (userId, cartItemId, quantity) => {
  const checkStockQuery = `
    SELECT p.id AS product_id, p.stock, p.name, p.is_active
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.id = $1 AND ci.user_id = $2;
  `;

  const itemResult = await db.query(checkStockQuery, [cartItemId, userId]);

  // Jika item keranjang tidak ditemukan
  if (itemResult.rows.length === 0) {
    throw createServiceError("Item keranjang tidak ditemukan", 404);
  }

  const product = itemResult.rows[0];

  // Cek jika produk sudah tidak aktif
  if (!product.is_active) {
    throw createServiceError(
      `Produk '${product.name}' sudah tidak tersedia`,
      400,
    );
  }

  // Cek apakah quantity yang diminta melebihi stok
  if (quantity > product.stock) {
    throw createServiceError(
      `Stok tidak mencukupi. Stok '${product.name}' tersisa ${product.stock}`,
      400,
    );
  }

  // Jika stok cukup, lakukan UPDATE quantity
  const query = `
    UPDATE cart_items 
    SET quantity = $1, updated_at = NOW()
    WHERE id = $2 AND user_id = $3
    RETURNING *;
  `;
  const result = await db.query(query, [quantity, cartItemId, userId]);
  return result.rows[0];
};

// Hapus item dari keranjang
const removeFromCart = async (userId, cartItemId) => {
  const query = `
    DELETE FROM cart_items
    WHERE id = $1 AND user_id = $2
    RETURNING id;
  `;
  const result = await db.query(query, [cartItemId, userId]);
  return result.rows[0];
};

const clearAllCart = async (userId) => {
  const query = `
    DELETE FROM cart_items
    WHERE user_id = $1
    RETURNING *;
  `;
  const result = await db.query(query, [userId]);
  return result.rows;
};

module.exports = {
  addToCart,
  getCartByUser,
  updateCartQuantity,
  removeFromCart,
  clearAllCart,
};
