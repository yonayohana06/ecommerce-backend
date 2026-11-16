const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");

const db = require("../../src/config/db");
const {
  recordAuditLog,
  listAuditLogs,
} = require("../../src/services/auditLogService");

const runDbTests = process.env.RUN_DB_TESTS === "1";
const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let adminId;
let adminEmail;

before(async () => {
  if (!runDbTests) return;

  adminEmail = `audit-service-${suffix}@example.com`;

  const result = await db.query(
    `INSERT INTO users (name, email, password, role)
     VALUES ($1, $2, $3, 'admin')
     RETURNING id, email`,
    ["Audit Service Test", adminEmail, "hash-tidak-dipakai"],
  );

  adminId = result.rows[0].id;
});

beforeEach(async () => {
  if (!runDbTests) return;
  await db.query("DELETE FROM audit_logs WHERE actor_id = $1", [adminId]);
});

after(async () => {
  if (runDbTests && adminId) {
    await db.query("DELETE FROM audit_logs WHERE actor_id = $1", [adminId]);
    await db.query("DELETE FROM users WHERE id = $1", [adminId]);
  }

  await db.pool.end();
});

dbTest(
  "recordAuditLog menyimpan aktor, aksi, entitas, before/after, dan IP",
  async () => {
    const log = await recordAuditLog({
      actor: { userId: adminId, email: adminEmail },
      action: "product.update",
      entityType: "product",
      entityId: "42",
      before: { name: "Produk Lama", price: 10000 },
      after: { name: "Produk Baru", price: 12000 },
      ipAddress: "127.0.0.1",
    });

    assert.equal(log.action, "product.update");
    assert.equal(log.entity_type, "product");
    assert.equal(log.entity_id, "42");
    assert.equal(String(log.actor_id), String(adminId));
    assert.equal(log.actor_email, adminEmail);
    assert.deepEqual(log.before_data, { name: "Produk Lama", price: 10000 });
    assert.deepEqual(log.after_data, { name: "Produk Baru", price: 12000 });
    assert.equal(log.ip_address, "127.0.0.1");

    const stored = await db.query("SELECT * FROM audit_logs WHERE id = $1", [
      log.id,
    ]);
    assert.equal(stored.rows.length, 1);
  },
);

dbTest(
  "listAuditLogs mengembalikan log terbaru lebih dulu dengan pagination",
  async () => {
    for (const status of ["PENDING", "PROCESSING", "PAID"]) {
      await recordAuditLog({
        actor: { userId: adminId, email: adminEmail },
        action: "order.status.update",
        entityType: "order",
        entityId: "99",
        after: { status },
      });
    }

    const result = await listAuditLogs({ page: 1, limit: 2 });

    assert.equal(result.pagination.totalItems, 3);
    assert.equal(result.pagination.totalPages, 2);
    assert.equal(result.logs.length, 2);
    assert.deepEqual(result.logs[0].after_data, { status: "PAID" });
    assert.deepEqual(result.logs[1].after_data, { status: "PROCESSING" });

    const pageTwo = await listAuditLogs({ page: 2, limit: 2 });
    assert.equal(pageTwo.logs.length, 1);
    assert.equal(pageTwo.pagination.hasNextPage, false);
  },
);

dbTest(
  "listAuditLogs dapat difilter berdasarkan entity_type dan action",
  async () => {
    await recordAuditLog({
      actor: { userId: adminId, email: adminEmail },
      action: "product.create",
      entityType: "product",
      entityId: "7",
      after: { name: "Produk" },
    });
    await recordAuditLog({
      actor: { userId: adminId, email: adminEmail },
      action: "category.create",
      entityType: "category",
      entityId: "3",
      after: { name: "Kategori" },
    });

    const products = await listAuditLogs({ entityType: "product" });
    assert.equal(products.pagination.totalItems, 1);
    assert.equal(products.logs[0].action, "product.create");

    const creates = await listAuditLogs({ action: "category.create" });
    assert.equal(creates.pagination.totalItems, 1);
    assert.equal(creates.logs[0].entity_type, "category");
  },
);

dbTest("listAuditLogs dapat difilter berdasarkan actor_id", async () => {
  await recordAuditLog({
    actor: { userId: adminId, email: adminEmail },
    action: "category.delete",
    entityType: "category",
    entityId: "5",
    before: { name: "Kategori Lama" },
  });

  const found = await listAuditLogs({ actorId: String(adminId) });
  assert.equal(found.pagination.totalItems, 1);
  assert.equal(found.logs[0].action, "category.delete");

  const notFound = await listAuditLogs({ actorId: "999999999" });
  assert.equal(notFound.pagination.totalItems, 0);
  assert.deepEqual(notFound.logs, []);
});
