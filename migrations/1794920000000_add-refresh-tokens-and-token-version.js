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
    token_version: { type: "integer", notNull: true, default: 1 },
  });

  pgm.createTable("refresh_tokens", {
    id: { type: "bigserial", primaryKey: true },
    user_id: {
      type: "bigint",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    token_hash: { type: "varchar(64)", notNull: true, unique: true },
    family_id: { type: "uuid", notNull: true },
    portal: {
      type: "varchar(10)",
      notNull: true,
      check: "portal IN ('user', 'admin')",
    },
    token_version: { type: "integer", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    revoked_at: { type: "timestamptz" },
    replaced_by_id: {
      type: "bigint",
      references: "refresh_tokens",
      onDelete: "SET NULL",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.createIndex("refresh_tokens", ["user_id", "revoked_at"], {
    name: "idx_refresh_tokens_user_active",
  });
  pgm.createIndex("refresh_tokens", "family_id", {
    name: "idx_refresh_tokens_family",
  });
  pgm.createIndex("refresh_tokens", "expires_at", {
    name: "idx_refresh_tokens_expires_at",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("refresh_tokens");
  pgm.dropColumn("users", "token_version");
};
