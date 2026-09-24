const { pool } = require("../config/db");

const checkoutOrder = async ({ userId, items, shippingAddress }) => {
  const client = await pool.connect(); // Dedicated client untuk transaksi

  try {
    await client.query("BEGIN");

    let totalAmount = 0;
    const itemsToInsert = [];

    for (const item of items) {
      // 1. Lock baris produk untuk mencegah race condition (FOR UPDATE)
      const productQuery = `
        SELECT id, name, price, stock, is_active 
        FROM products 
        WHERE id = $1 FOR UPDATE;
      `;
      const productRes = await client.query(productQuery, [item.product_id]);

      if (productRes.rows.length === 0) {
        throw new Error(`Produk dengan ID ${item.product_id} tidak ditemukan.`);
      }

      const product = productRes.rows[0];

      if (!product.is_active) {
        throw new Error(`Produk "${product.name}" sedang tidak aktif.`);
      }

      if (product.stock < item.quantity) {
        throw new Error(
          `Stok "${product.name}" tidak mencukupi (Sisa: ${product.stock}).`,
        );
      }

      const price = parseFloat(product.price);
      const subtotal = price * item.quantity;
      totalAmount += subtotal;

      itemsToInsert.push({
        product_id: product.id,
        quantity: item.quantity,
        price_at_purchase: price,
      });

      // 2. Kurangi stok produk secara langsung
      await client.query(
        "UPDATE products SET stock = stock - $1 WHERE id = $2;",
        [item.quantity, product.id],
      );
    }

    // 3. Simpan header order
    const orderInsertQuery = `
      INSERT INTO orders (user_id, total_amount, status, shipping_address)
      VALUES ($1, $2, 'PENDING', $3)
      RETURNING id, created_at, status;
    `;
    const orderRes = await client.query(orderInsertQuery, [
      userId,
      totalAmount,
      shippingAddress,
    ]);
    const createdOrder = orderRes.rows[0];

    // 4. Simpan seluruh item ke order_items
    for (const orderItem of itemsToInsert) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase)
         VALUES ($1, $2, $3, $4);`,
        [
          createdOrder.id,
          orderItem.product_id,
          orderItem.quantity,
          orderItem.price_at_purchase,
        ],
      );
    }

    // 5. Eksekusi commit semua query jika tidak ada kendala
    await client.query("COMMIT");

    return {
      order_id: createdOrder.id,
      user_id: userId,
      status: createdOrder.status,
      total_amount: totalAmount,
      shipping_address: shippingAddress,
      created_at: createdOrder.created_at,
    };
  } catch (error) {
    await client.query("ROLLBACK"); // Batalkan seluruh query jika ada error
    throw error;
  } finally {
    client.release(); // Kembalikan koneksi ke pool
  }
};

const updateOrderStatus = async ({ orderId, targetStatus }) => {
  const query = `
    UPDATE orders 
    SET status = $1, updated_at = NOW() 
    WHERE id = $2 AND status != $1
    RETURNING id, user_id, status, total_amount;
  `;

  const result = await pool.query(query, [targetStatus, orderId]);

  // Jika baris yang ter-update 0, berarti order ID tidak ada atau statusnya memang sudah PAID
  if (result.rows.length === 0) {
    const checkOrder = await pool.query(
      "SELECT id, status FROM orders WHERE id = $1",
      [orderId],
    );
    if (checkOrder.rows.length === 0) {
      throw new Error(`Order ID ${orderId} tidak ditemukan.`);
    }
    // Jika order sudah PAID sebelumnya, kembalikan statusnya tanpa melempar error (idempotent)
    return { ...checkOrder.rows[0], already_processed: true };
  }

  return { ...result.rows[0], already_processed: false };
};

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

module.exports = {
  checkout,
  checkoutOrder,
  updateOrderStatus,
};
