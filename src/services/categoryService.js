const db = require("../config/db");

// Helper untuk membuat slug ramah URL
const generateSlug = (text) => {
  if (!text) return "";
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize("NFD") // Pisahkan aksen jika ada
    .replace(/[\u0300-\u036f]/g, "") // Hapus karakter aksen
    .replace(/[^a-z0-9\s-]/g, "") // Hapus karakter selain huruf, angka, spasi, dash
    .replace(/\s+/g, "-") // Ganti spasi dengan tanda minus
    .replace(/-+/g, "-") // Hapus minus berulang
    .replace(/^-+|-+$/g, ""); // Hapus minus di awal atau akhir
};

// Ambil semua kategori (disertai jumlah produk aktif yang terkait)
const getAllCategories = async ({ search } = {}) => {
  const conditions = [];
  const values = [];

  if (search && search.trim() !== "") {
    values.push(`%${search.trim()}%`);
    conditions.push(`c.name ILIKE $${values.length}`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT 
      c.id, 
      c.name, 
      c.slug, 
      c.icon_url, 
      c.created_at,
      COUNT(p.id) FILTER (WHERE p.is_active = true)::int AS product_count
    FROM categories c
    LEFT JOIN products p ON c.id = p.category_id
    ${whereClause}
    GROUP BY c.id
    ORDER BY c.name ASC;
  `;

  const result = await db.query(query, values);
  return result.rows;
};

// Ambil detail kategori berdasarkan ID
const getCategoryById = async (id) => {
  const query = `
    SELECT 
      c.id, 
      c.name, 
      c.slug, 
      c.icon_url, 
      c.created_at,
      COUNT(p.id) FILTER (WHERE p.is_active = true)::int AS product_count
    FROM categories c
    LEFT JOIN products p ON c.id = p.category_id
    WHERE c.id = $1
    GROUP BY c.id;
  `;

  const result = await db.query(query, [id]);
  return result.rows[0] || null;
};

// Ambil detail kategori berdasarkan Slug
const getCategoryBySlug = async (slug) => {
  const query = `
    SELECT 
      c.id, 
      c.name, 
      c.slug, 
      c.icon_url, 
      c.created_at,
      COUNT(p.id) FILTER (WHERE p.is_active = true)::int AS product_count
    FROM categories c
    LEFT JOIN products p ON c.id = p.category_id
    WHERE c.slug = $1
    GROUP BY c.id;
  `;

  const result = await db.query(query, [slug]);
  return result.rows[0] || null;
};

// Buat kategori baru (Admin)
const createCategory = async ({ name, slug, icon_url }) => {
  const trimmedName = name.trim();
  const finalSlug =
    slug && slug.trim() ? generateSlug(slug) : generateSlug(trimmedName);

  if (!finalSlug) {
    const error = new Error("Slug kategori tidak valid");
    error.statusCode = 400;
    throw error;
  }

  // Cek apakah nama atau slug sudah ada
  const checkQuery = `
    SELECT id, name, slug FROM categories 
    WHERE LOWER(name) = LOWER($1) OR slug = $2;
  `;
  const existing = await db.query(checkQuery, [trimmedName, finalSlug]);

  if (existing.rows.length > 0) {
    const duplicate = existing.rows[0];
    const isNameDuplicate =
      duplicate.name.toLowerCase() === trimmedName.toLowerCase();
    const error = new Error(
      isNameDuplicate
        ? `Kategori dengan nama '${trimmedName}' sudah terdaftar`
        : `Kategori dengan slug '${finalSlug}' sudah terdaftar`,
    );
    error.statusCode = 400;
    throw error;
  }

  const insertQuery = `
    INSERT INTO categories (name, slug, icon_url)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;
  const result = await db.query(insertQuery, [
    trimmedName,
    finalSlug,
    icon_url || null,
  ]);

  return result.rows[0];
};

// Perbarui kategori (Admin)
const updateCategory = async (id, { name, slug, icon_url }) => {
  // 1. Cek apakah kategori ada
  const existingCategory = await getCategoryById(id);
  if (!existingCategory) {
    return null;
  }

  const updatedName = name !== undefined ? name.trim() : existingCategory.name;
  let updatedSlug = existingCategory.slug;

  if (slug !== undefined && slug.trim()) {
    updatedSlug = generateSlug(slug);
  } else if (name !== undefined && name.trim()) {
    // Jika nama diubah tapi slug tidak dikirim, generate slug baru dari nama baru
    updatedSlug = generateSlug(updatedName);
  }

  // 2. Cek apakah ada konflik nama / slug dengan kategori lain
  const checkDuplicateQuery = `
    SELECT id, name, slug FROM categories 
    WHERE (LOWER(name) = LOWER($1) OR slug = $2) AND id != $3;
  `;
  const duplicateCheck = await db.query(checkDuplicateQuery, [
    updatedName,
    updatedSlug,
    id,
  ]);

  if (duplicateCheck.rows.length > 0) {
    const duplicate = duplicateCheck.rows[0];
    const isNameDuplicate =
      duplicate.name.toLowerCase() === updatedName.toLowerCase();
    const error = new Error(
      isNameDuplicate
        ? `Kategori dengan nama '${updatedName}' sudah digunakan oleh kategori lain`
        : `Slug '${updatedSlug}' sudah digunakan oleh kategori lain`,
    );
    error.statusCode = 400;
    throw error;
  }

  const updateQuery = `
    UPDATE categories
    SET 
      name = $1,
      slug = $2,
      icon_url = COALESCE($3, icon_url)
    WHERE id = $4
    RETURNING *;
  `;

  const updatedIconUrl =
    icon_url !== undefined ? icon_url || null : existingCategory.icon_url;

  const result = await db.query(updateQuery, [
    updatedName,
    updatedSlug,
    updatedIconUrl,
    id,
  ]);

  return result.rows[0];
};

// Hapus kategori (Admin)
const deleteCategory = async (id) => {
  // 1. Cek keberadaan kategori
  const existingCategory = await getCategoryById(id);
  if (!existingCategory) {
    return null;
  }

  // 2. Hitung jumlah produk yang menggunakan kategori ini
  const countProductQuery = `
    SELECT COUNT(*)::int AS count 
    FROM products 
    WHERE category_id = $1;
  `;
  const countResult = await db.query(countProductQuery, [id]);
  const affectedProductsCount = countResult.rows[0]?.count
    ? parseInt(countResult.rows[0].count, 10)
    : 0;

  // 3. Hapus kategori (Foreign key products.category_id ON DELETE SET NULL akan otomatis set category_id = NULL)
  const deleteQuery = `
    DELETE FROM categories 
    WHERE id = $1 
    RETURNING *;
  `;
  const result = await db.query(deleteQuery, [id]);

  return {
    category: result.rows[0],
    affected_products_count: affectedProductsCount,
  };
};

module.exports = {
  generateSlug,
  getAllCategories,
  getCategoryById,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
};
