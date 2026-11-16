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
  pgm.createTable("audit_logs", {
    id: "bigserial",
    actor_id: {
      type: "bigint",
      references: "users",
      onDelete: "SET NULL",
    },
    actor_email: { type: "text" },
    action: { type: "text", notNull: true },
    entity_type: { type: "text", notNull: true },
    entity_id: { type: "text", notNull: true },
    before_data: { type: "jsonb" },
    after_data: { type: "jsonb" },
    ip_address: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.createIndex("audit_logs", ["created_at"]);
  pgm.createIndex("audit_logs", ["entity_type", "entity_id"]);
  pgm.createIndex("audit_logs", ["actor_id"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("audit_logs");
};
