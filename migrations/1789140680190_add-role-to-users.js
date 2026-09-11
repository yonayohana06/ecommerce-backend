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
  pgm.addColumn("users", {
    role: {
      type: "varchar(20)",
      notNull: true,
      default: "user",
    },
  });

  // Set akun admin bawaan
  pgm.sql(`
    UPDATE users 
    SET role = 'admin' 
    WHERE email = 'admin@example.com';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumn("users", "role");
};
