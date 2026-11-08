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
  // Selaraskan tipe FK dengan users.id dan products.id yang sudah bigint.
  // Index dan foreign key otomatis dibangun ulang oleh PostgreSQL.
  pgm.sql(
    "ALTER TABLE cart_items ALTER COLUMN user_id TYPE bigint USING user_id::bigint;",
  );
  pgm.sql(
    "ALTER TABLE cart_items ALTER COLUMN product_id TYPE bigint USING product_id::bigint;",
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Rollback gagal jika ada nilai di luar jangkauan integer, yang memang
  // menandakan data sudah tidak aman untuk tipe lama.
  pgm.sql(
    "ALTER TABLE cart_items ALTER COLUMN user_id TYPE integer USING user_id::integer;",
  );
  pgm.sql(
    "ALTER TABLE cart_items ALTER COLUMN product_id TYPE integer USING product_id::integer;",
  );
};
