const db = require("../config/db");

// Tambah ke keranjang (Upsert: Insert jika belum ada, Update quantity jika sudah ada)
const addToCart = async (userId, productId, quantity) => {
  const query = `
    INSERT INTO cart_items (user_id, product_id, quantity, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (user_id, product_id) 
    DO UPDATE SET 
      quantity = cart_items.quantity + EXCLUDED.quantity,
      updated_at = NOW()
    RETURNING *;
  `;
  const result = await db.query(query, [userId, productId, quantity]);
  return result.rows[0];
};

// Ambil isi keranjang user beserta detail produknya
const getCartByUser = async (userId) => {
  const query = `
    SELECT 
      ci.id AS cart_item_id,
      ci.product_id,
      p.name AS product_name,
      p.price,
      p.image_url,
      ci.quantity,
      (p.price * ci.quantity) AS subtotal
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.user_id = $1 AND p.is_active = true
    ORDER BY ci.created_at DESC;
  `;
  const result = await db.query(query, [userId]);
  return result.rows;
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
    const error = new Error("Item keranjang tidak ditemukan");
    error.statusCode = 404;
    throw error;
  }

  const product = itemResult.rows[0];

  // Cek jika produk sudah tidak aktif
  if (!product.is_active) {
    const error = new Error(`Produk '${product.name}' sudah tidak tersedia`);
    error.statusCode = 400;
    throw error;
  }

  // Cek apakah quantity yang diminta melebihi stok
  if (quantity > product.stock) {
    const error = new Error(
      `Stok tidak mencukupi. Stok '${product.name}' tersisa ${product.stock}`,
    );
    error.statusCode = 400;
    throw error;
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
