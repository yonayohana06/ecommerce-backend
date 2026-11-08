/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Backfill data lama sebelum menambahkan NOT NULL.
  pgm.sql("UPDATE products SET is_active = true WHERE is_active IS NULL;");
  pgm.alterColumn("products", "is_active", { notNull: true });

  pgm.sql("UPDATE orders SET status = 'PENDING' WHERE status IS NULL;");
  pgm.alterColumn("orders", "status", { notNull: true });

  pgm.addConstraint("users", "users_role_check", {
    check: "role IN ('user', 'admin')",
  });

  pgm.addConstraint("cart_items", "cart_items_quantity_check", {
    check: "quantity > 0",
  });

  // Nilai timestamp lama dianggap memakai timezone sesi database.
  pgm.sql(`
    ALTER TABLE cart_items
      ALTER COLUMN created_at TYPE timestamptz
        USING created_at AT TIME ZONE current_setting('TimeZone'),
      ALTER COLUMN updated_at TYPE timestamptz
        USING updated_at AT TIME ZONE current_setting('TimeZone');
  `);

  pgm.createIndex("orders", ["status", "created_at"], {
    name: "idx_orders_status_created",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex("orders", ["status", "created_at"], {
    name: "idx_orders_status_created",
  });

  pgm.sql(`
    ALTER TABLE cart_items
      ALTER COLUMN created_at TYPE timestamp
        USING created_at AT TIME ZONE current_setting('TimeZone'),
      ALTER COLUMN updated_at TYPE timestamp
        USING updated_at AT TIME ZONE current_setting('TimeZone');
  `);

  pgm.dropConstraint("cart_items", "cart_items_quantity_check");
  pgm.dropConstraint("users", "users_role_check");

  pgm.alterColumn("orders", "status", { notNull: false });
  pgm.alterColumn("products", "is_active", { notNull: false });
};
