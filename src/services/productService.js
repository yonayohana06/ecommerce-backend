const db = require('../config/db');

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

module.exports = {
    getProducts,
};