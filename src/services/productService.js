const db = require('../config/db');
const { get } = require('../routes/authRoutes');

const getProducts = async ({ categoryId, search, page = 1, limit = 10 }) => {
  const conditions = ['p.is_active = TRUE'];
  const values = [];

  // 1. Filter Kategori (jika dikirim)
  if (categoryId) {
    values.push(parseInt(categoryId));
    conditions.push(`p.category_id = $${values.length}`);
  }

  // 2. Search Keyword (ILIKE = case-insensitive search)
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`p.name ILIKE $${values.length}`);
  }

  // Gabungkan semua kondisi dengan AND
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Hitung offset untuk pagination
  const offset = (page - 1) * limit;
  values.push(parseInt(limit));
  const limitPlaceholder = `$${values.length}`;
  values.push(parseInt(offset));
  const offsetPlaceholder = `$${values.length}`;

  const query = `
    SELECT 
      p.id,
      p.name,
      p.price,
      p.stock,
      p.image_url,
      c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    ${whereClause}
    ORDER BY p.id DESC
    LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder};
  `;

  const result = await db.query(query, values);
  return result.rows;
};

const getProductById = async (id) => {
  const query = `
        SELECT 
          p.id,
          p.name,
          p.description,
          p.price,
          p.stock,
          p.image_url,
          p.category_id,
          c.name AS category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.id = $1 AND p.is_active = TRUE;
    `;

  const result = await db.query(query, [id]);

  // Kembalikan objek produk jika ditemukan, atau null jika tidak ada
  return result.rows[0] || null;
};

const createProduct = async (data) => {
  const { category_id, name, description, price, stock, image_url, is_active } = data;
  const query = `
    INSERT INTO products (category_id, name, description, price, stock, image_url, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
  `;
  const values = [
    category_id || null,
    name,
    description || null,
    price,
    stock,
    image_url || null,
    is_active !== undefined ? is_active : true
  ];
  const result = await db.query(query, values);
  return result.rows[0];
};

const updateProduct = async (id, data) => {
  const { category_id, name, description, price, stock, image_url, is_active } = data;
  const query = `
    UPDATE products 
    SET 
      category_id = COALESCE($1, category_id),
      name = COALESCE($2, name),
      description = COALESCE($3, description),
      price = COALESCE($4, price),
      stock = COALESCE($5, stock),
      image_url = COALESCE($6, image_url),
      is_active = COALESCE($7, is_active),
      updated_at = NOW()
    WHERE id = $8
    RETURNING *;
  `;
  const values = [category_id, name, description, price, stock, image_url, is_active, id];
  const result = await db.query(query, values);
  return result.rows[0];
};

const deleteProduct = async (id) => {
  // 1. Cek apakah produk pernah ada di tabel order_items
  const checkOrderQuery = `
    SELECT COUNT(*) 
    FROM order_items 
    WHERE product_id = $1;
  `;
  const orderCheckResult = await db.query(checkOrderQuery, [id]);
  const hasBeenPurchased = parseInt(orderCheckResult.rows[0].count, 10) > 0;

  // 2. Jika SUDAH PERNAH DIBELI -> Soft Delete (Ubah is_active = false)
  if (hasBeenPurchased) {
    const softDeleteQuery = `
      UPDATE products 
      SET is_active = false, updated_at = NOW() 
      WHERE id = $1 
      RETURNING *, 'soft_deleted' AS delete_type;
    `;
    const result = await db.query(softDeleteQuery, [id]);
    return result.rows[0];
  }

  // 3. Jika BELUM PERNAH DIBELI -> Hard Delete (Hapus permanen dari DB)
  const hardDeleteQuery = `
    DELETE FROM products 
    WHERE id = $1 
    RETURNING *, 'hard_deleted' AS delete_type;
  `;
  const result = await db.query(hardDeleteQuery, [id]);
  return result.rows[0];
};

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct
};