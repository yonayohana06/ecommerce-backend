const { once } = require("node:events");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = require("../../src/app");
const db = require("../../src/config/db");

const runDbTests = process.env.RUN_DB_TESTS === "1";

const uniqueEmail = (prefix = "test") =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

const uniqueSuffix = () =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function startTestServer() {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function request(
  baseUrl,
  path,
  { method = "GET", token, body, formData, headers = {} } = {},
) {
  const requestHeaders = { ...headers };
  const init = { method, headers: requestHeaders };

  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }

  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();

  let parsed = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return { status: response.status, body: parsed, headers: response.headers };
}

async function registerUser(
  baseUrl,
  { email = uniqueEmail("user"), name = "User Test", password = "Password123!" } = {},
) {
  const response = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: { name, email, password },
  });

  return { response, credentials: { email, password } };
}

async function loginUser(baseUrl, { email, password = "Password123!" }) {
  return request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

async function createAdmin(
  { email = uniqueEmail("admin"), name = "Admin Test", password = "Password123!" } = {},
) {
  const passwordHash = await bcrypt.hash(password, 4);
  const result = await db.query(
    `INSERT INTO users (name, email, password, role)
     VALUES ($1, $2, $3, 'admin')
     RETURNING id, name, email, role`,
    [name, email, passwordHash],
  );

  return { admin: result.rows[0], credentials: { email, password } };
}

async function loginAdmin(baseUrl, { email, password = "Password123!" }) {
  return request(baseUrl, "/api/admin/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

function signToken(payload, secret) {
  return jwt.sign(payload, secret);
}

async function createCategory({ name, slug } = {}) {
  const suffix = uniqueSuffix();
  const finalName = name || `Kategori Test ${suffix}`;
  const finalSlug = slug || `kategori-test-${suffix}`;
  const result = await db.query(
    `INSERT INTO categories (name, slug)
     VALUES ($1, $2)
     RETURNING *`,
    [finalName, finalSlug],
  );

  return result.rows[0];
}

async function createProduct(
  {
    name,
    price = 10000,
    stock = 10,
    categoryId = null,
    isActive = true,
  } = {},
) {
  const finalName = name || `Produk Test ${uniqueSuffix()}`;
  const result = await db.query(
    `INSERT INTO products (name, price, stock, category_id, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [finalName, price, stock, categoryId, isActive],
  );

  return result.rows[0];
}

async function createOrderWithItems({
  userId,
  productId,
  quantity = 1,
  price = 10000,
  status = "PENDING",
  stock = null,
}) {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      `INSERT INTO orders (user_id, total_amount, status, shipping_address)
       VALUES ($1, $2, $3::order_status, 'Alamat Test')
       RETURNING *`,
      [userId, quantity * price, status],
    );

    const order = orderResult.rows[0];

    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase)
       VALUES ($1, $2, $3, $4)`,
      [order.id, productId, quantity, price],
    );

    if (stock !== null) {
      await client.query("UPDATE products SET stock = $1 WHERE id = $2", [
        stock,
        productId,
      ]);
    }

    await client.query("COMMIT");
    return order;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanup({
  userIds = [],
  productIds = [],
  categoryIds = [],
} = {}) {
  if (userIds.length > 0) {
    await db.query("DELETE FROM orders WHERE user_id = ANY($1::bigint[])", [
      userIds,
    ]);
    await db.query("DELETE FROM cart_items WHERE user_id = ANY($1::bigint[])", [
      userIds,
    ]);
  }

  if (productIds.length > 0) {
    await db.query("DELETE FROM products WHERE id = ANY($1::bigint[])", [
      productIds,
    ]);
  }

  if (categoryIds.length > 0) {
    await db.query("DELETE FROM categories WHERE id = ANY($1::integer[])", [
      categoryIds,
    ]);
  }

  if (userIds.length > 0) {
    await db.query("DELETE FROM users WHERE id = ANY($1::bigint[])", [userIds]);
  }
}

module.exports = {
  runDbTests,
  uniqueEmail,
  uniqueSuffix,
  startTestServer,
  request,
  registerUser,
  loginUser,
  createAdmin,
  loginAdmin,
  signToken,
  createCategory,
  createProduct,
  createOrderWithItems,
  cleanup,
  db,
};
