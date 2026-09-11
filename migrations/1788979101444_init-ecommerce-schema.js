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
    // 1. Extension Trigram
    pgm.createExtension('pg_trgm', { ifNotExists: true });

    // 2. Custom Type Enum untuk Order Status
    pgm.createType('order_status', [
        'PENDING',
        'PAID',
        'PROCESSING',
        'SHIPPED',
        'COMPLETED',
        'CANCELLED',
        'FAILED',
    ]);

    // 3. Tabel Users
    pgm.createTable('users', {
        id: { type: 'bigserial', primaryKey: true },
        name: { type: 'varchar(100)', notNull: true },
        email: { type: 'varchar(150)', notNull: true, unique: true },
        password: { type: 'varchar(255)', notNull: true },
        phone_number: { type: 'varchar(20)' },
        created_at: {
            type: 'timestamptz',
            default: pgm.func('CURRENT_TIMESTAMP'),
        },
        updated_at: {
            type: 'timestamptz',
            default: pgm.func('CURRENT_TIMESTAMP'),
        },
    });

    // 4. Tabel Categories
    pgm.createTable('categories', {
        id: { type: 'serial', primaryKey: true },
        name: { type: 'varchar(100)', notNull: true },
        slug: { type: 'varchar(100)', notNull: true, unique: true },
        icon_url: { type: 'text' },
        created_at: {
            type: 'timestamptz',
            default: pgm.func('CURRENT_TIMESTAMP'),
        },
    });

    // 5. Tabel Products
    pgm.createTable('products', {
        id: { type: 'bigserial', primaryKey: true },
        category_id: {
            type: 'integer',
            references: '"categories"',
            onDelete: 'SET NULL',
        },
        name: { type: 'varchar(200)', notNull: true },
        description: { type: 'text' },
        price: {
            type: 'numeric(12)',
            notNull: true,
            check: 'price >= 0',
        },
        stock: {
            type: 'integer',
            notNull: true,
            default: 0,
            check: 'stock >= 0',
        },
        image_url: { type: 'text' },
        is_active: { type: 'boolean', default: true },
        created_at: {
            type: 'timestamptz',
            default: pgm.func('CURRENT_TIMESTAMP'),
        },
        updated_at: {
            type: 'timestamptz',
            default: pgm.func('CURRENT_TIMESTAMP'),
        },
    });

    // 6. Tabel Orders
    pgm.createTable('orders', {
        id: { type: 'bigserial', primaryKey: true },
        user_id: {
            type: 'bigint',
            notNull: true,
            references: '"users"',
            onDelete: 'RESTRICT',
        },
        total_amount: {
            type: 'numeric(12)',
            notNull: true,
            default: 0,
        },
        status: {
            type: 'order_status',
            default: 'PENDING',
        },
        shipping_address: { type: 'text', notNull: true },
        created_at: {
            type: 'timestamptz',
            default: pgm.func('CURRENT_TIMESTAMP'),
        },
        updated_at: {
            type: 'timestamptz',
            default: pgm.func('CURRENT_TIMESTAMP'),
        },
    });

    // 7. Tabel Order Items
    pgm.createTable('order_items', {
        id: { type: 'bigserial', primaryKey: true },
        order_id: {
            type: 'bigint',
            notNull: true,
            references: '"orders"',
            onDelete: 'CASCADE',
        },
        product_id: {
            type: 'bigint',
            notNull: true,
            references: '"products"',
            onDelete: 'RESTRICT',
        },
        quantity: {
            type: 'integer',
            notNull: true,
            check: 'quantity > 0',
        },
        price_at_purchase: {
            type: 'numeric(12)',
            notNull: true,
            check: 'price_at_purchase >= 0',
        },
        created_at: {
            type: 'timestamptz',
            default: pgm.func('CURRENT_TIMESTAMP'),
        },
    });

    // 8. B-Tree Indexes
    pgm.createIndex('products', 'category_id', { name: 'idx_products_category' });
    pgm.createIndex('products', 'is_active', { name: 'idx_products_active' });
    pgm.createIndex('orders', 'user_id', { name: 'idx_orders_user' });
    pgm.createIndex('order_items', 'order_id', { name: 'idx_order_items_order' });

    // 9. GIN Trigram Index (Untuk Pencarian Nama Produk / ILIKE)
    // pgm.createIndex('products', 'name', {
    //     name: 'idx_products_name_trgm',
    //     method: 'gin',
    //     opclass: 'gin_trgm_ops',
    // });
    pgm.sql('CREATE INDEX "idx_products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops);');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
    // Drop Indexes
    pgm.sql('DROP INDEX IF EXISTS "idx_products_name_trgm";');
    // pgm.dropIndex('products', 'name', { name: 'idx_products_name_trgm' });
    pgm.dropIndex('order_items', 'order_id', { name: 'idx_order_items_order' });
    pgm.dropIndex('orders', 'user_id', { name: 'idx_orders_user' });
    pgm.dropIndex('products', 'is_active', { name: 'idx_products_active' });
    pgm.dropIndex('products', 'category_id', { name: 'idx_products_category' });

    // Drop Tables
    pgm.dropTable('order_items');
    pgm.dropTable('orders');
    pgm.dropTable('products');
    pgm.dropTable('categories');
    pgm.dropTable('users');

    // Drop Enum Type & Extension
    pgm.dropType('order_status');
    pgm.dropExtension('pg_trgm', { ifExists: true });
};
