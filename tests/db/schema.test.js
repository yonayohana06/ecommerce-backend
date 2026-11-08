const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const db = require("../../src/config/db");

const runDbTests = process.env.RUN_DB_TESTS === "1";

after(async () => {
  await db.pool.end();
});

async function getColumn(table, column) {
  const result = await db.query(
    `SELECT data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );

  return result.rows[0];
}

async function getConstraint(table, name) {
  const result = await db.query(
    `SELECT pg_get_constraintdef(pc.oid) AS definition
     FROM pg_constraint pc
     JOIN pg_class c ON c.oid = pc.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = $1 AND pc.conname = $2`,
    [table, name],
  );

  return result.rows[0];
}

async function getIndex(table, name) {
  const result = await db.query(
    `SELECT indexdef
     FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2`,
    [table, name],
  );

  return result.rows[0];
}

async function expectStatementError(sql, params, expectedCode) {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    await assert.rejects(
      () => client.query(sql, params),
      (error) => error.code === expectedCode,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

const uniqueEmail = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

test(
  "products.is_active wajib NOT NULL dengan default true",
  { skip: !runDbTests },
  async () => {
    const column = await getColumn("products", "is_active");

    assert.equal(column.is_nullable, "NO");
    assert.match(column.column_default, /true/);
  },
);

test(
  "orders.status wajib NOT NULL dengan default PENDING",
  { skip: !runDbTests },
  async () => {
    const column = await getColumn("orders", "status");

    assert.equal(column.is_nullable, "NO");
    assert.match(column.column_default, /PENDING/);
  },
);

test(
  "users.role memiliki CHECK hanya user atau admin",
  { skip: !runDbTests },
  async () => {
    const constraint = await getConstraint("users", "users_role_check");

    assert.ok(constraint, "constraint users_role_check belum ada");
    assert.match(constraint.definition, /role/);
    assert.match(constraint.definition, /user/);
    assert.match(constraint.definition, /admin/);
  },
);

test(
  "cart_items.quantity memiliki CHECK lebih dari 0",
  { skip: !runDbTests },
  async () => {
    const constraint = await getConstraint(
      "cart_items",
      "cart_items_quantity_check",
    );

    assert.ok(constraint, "constraint cart_items_quantity_check belum ada");
    assert.match(constraint.definition, /quantity > 0/);
  },
);

test(
  "timestamp cart_items memakai timestamptz",
  { skip: !runDbTests },
  async () => {
    const columns = await db.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'cart_items'
         AND column_name IN ('created_at', 'updated_at')
       ORDER BY column_name`,
    );

    assert.equal(columns.rows.length, 2);

    for (const column of columns.rows) {
      assert.equal(column.data_type, "timestamp with time zone");
    }
  },
);

test(
  "cart_items.user_id dan product_id memakai bigint",
  { skip: !runDbTests },
  async () => {
    const columns = await db.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'cart_items'
         AND column_name IN ('user_id', 'product_id')
       ORDER BY column_name`,
    );

    assert.equal(columns.rows.length, 2);

    for (const column of columns.rows) {
      assert.equal(
        column.data_type,
        "bigint",
        `cart_items.${column.column_name} seharusnya bigint`,
      );
    }
  },
);

test(
  "orders memiliki index (status, created_at)",
  { skip: !runDbTests },
  async () => {
    const index = await getIndex("orders", "idx_orders_status_created");

    assert.ok(index, "index idx_orders_status_created belum ada");
    assert.match(index.indexdef, /\(status, created_at\)/);
  },
);

test(
  "users memiliki unique index LOWER(email)",
  { skip: !runDbTests },
  async () => {
    const index = await getIndex("users", "users_email_lower_unique");

    assert.ok(index, "index users_email_lower_unique belum ada");
    assert.match(index.indexdef, /UNIQUE/i);
    assert.match(index.indexdef, /lower/i);
  },
);

test(
  "users.role menolak nilai selain user/admin",
  { skip: !runDbTests },
  async () => {
    await expectStatementError(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, $4)`,
      ["Invalid Role", uniqueEmail("invalid-role"), "hash", "superadmin"],
      "23514",
    );
  },
);

test(
  "orders.status menolak NULL",
  { skip: !runDbTests },
  async () => {
    await expectStatementError(
      `WITH new_user AS (
         INSERT INTO users (name, email, password, role)
         VALUES ('Status Null', $1, 'hash', 'user')
         RETURNING id
       )
       INSERT INTO orders (user_id, total_amount, shipping_address, status)
       SELECT id, 0, 'Alamat', NULL FROM new_user`,
      [uniqueEmail("status-null")],
      "23502",
    );
  },
);

test(
  "products.is_active menolak NULL",
  { skip: !runDbTests },
  async () => {
    await expectStatementError(
      `INSERT INTO products (name, price, stock, is_active)
       VALUES ('Produk Null', 1000, 1, NULL)`,
      [],
      "23502",
    );
  },
);

test(
  "cart_items.quantity menolak nilai 0",
  { skip: !runDbTests },
  async () => {
    await expectStatementError(
      `WITH new_user AS (
         INSERT INTO users (name, email, password, role)
         VALUES ('Cart Invalid', $1, 'hash', 'user')
         RETURNING id
       ),
       new_product AS (
         INSERT INTO products (name, price, stock)
         VALUES ('Produk Cart Invalid', 1000, 1)
         RETURNING id
       )
       INSERT INTO cart_items (user_id, product_id, quantity)
       SELECT u.id, p.id, 0 FROM new_user u CROSS JOIN new_product p`,
      [uniqueEmail("cart-invalid")],
      "23514",
    );
  },
);
