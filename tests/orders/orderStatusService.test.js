const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const db = require("../../src/config/db");
const ORDER_STATUS = require("../../src/constants/orderStatus");
const {
  changeOrderStatus,
  mapTransactionStatus,
  assertValidTransition,
  TRANSITIONS,
} = require("../../src/services/orderStatusService");
const orderService = require("../../src/services/orderService");
const paymentService = require("../../src/services/paymentService");

const runDbTests = process.env.RUN_DB_TESTS === "1";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let userId;
let productId;

before(async () => {
  if (!runDbTests) return;

  const userResult = await db.query(
    `INSERT INTO users (name, email, password, role)
     VALUES ($1, $2, $3, 'user')
     RETURNING id`,
    ["Order Status Test", `order-status-${suffix}@example.com`, "hash-tidak-dipakai"],
  );
  userId = userResult.rows[0].id;

  const productResult = await db.query(
    `INSERT INTO products (name, price, stock, is_active)
     VALUES ($1, 1000, 10, true)
     RETURNING id`,
    [`Produk Order Status ${suffix}`],
  );
  productId = productResult.rows[0].id;
});

after(async () => {
  if (runDbTests && userId) {
    await db.query("DELETE FROM orders WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM products WHERE id = $1", [productId]);
    await db.query("DELETE FROM users WHERE id = $1", [userId]);
  }

  await db.pool.end();
});

async function setStock(stock) {
  await db.query("UPDATE products SET stock = $1 WHERE id = $2", [
    stock,
    productId,
  ]);
}

async function getStock() {
  const result = await db.query("SELECT stock FROM products WHERE id = $1", [
    productId,
  ]);

  return result.rows[0].stock;
}

async function getOrder(orderId) {
  const result = await db.query("SELECT * FROM orders WHERE id = $1", [orderId]);

  return result.rows[0];
}

async function createOrder({
  status = ORDER_STATUS.PENDING,
  quantity = 2,
  totalAmount = 2000,
} = {}) {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      `INSERT INTO orders (user_id, total_amount, status, shipping_address)
       VALUES ($1, $2, $3::order_status, 'Alamat Test')
       RETURNING *`,
      [userId, totalAmount, status],
    );

    const order = orderResult.rows[0];

    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase)
       VALUES ($1, $2, $3, 1000)`,
      [order.id, productId, quantity],
    );

    await client.query("COMMIT");
    return order;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test(
  "membatalkan pesanan mengembalikan stok",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({ status: ORDER_STATUS.PENDING, quantity: 2 });
    await setStock(8);

    const result = await changeOrderStatus({
      orderId: order.id,
      newStatus: ORDER_STATUS.CANCELLED,
      source: "test",
    });

    assert.equal(result.changed, true);
    assert.equal(result.previousStatus, ORDER_STATUS.PENDING);
    assert.equal(result.order.status, ORDER_STATUS.CANCELLED);
    assert.equal(await getStock(), 10);
  },
);

test(
  "revert CANCELLED ke PAID memotong stok kembali",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({
      status: ORDER_STATUS.CANCELLED,
      quantity: 2,
    });
    await setStock(10);

    const result = await changeOrderStatus({
      orderId: order.id,
      newStatus: ORDER_STATUS.PAID,
      source: "test",
    });

    assert.equal(result.changed, true);
    assert.equal(result.order.status, ORDER_STATUS.PAID);
    assert.equal(await getStock(), 8);
  },
);

test(
  "status yang sama tidak mengubah stok dua kali",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({ status: ORDER_STATUS.PENDING, quantity: 2 });
    await setStock(8);

    const first = await changeOrderStatus({
      orderId: order.id,
      newStatus: ORDER_STATUS.CANCELLED,
      source: "webhook",
    });
    const second = await changeOrderStatus({
      orderId: order.id,
      newStatus: ORDER_STATUS.CANCELLED,
      source: "webhook",
    });

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(second.order.status, ORDER_STATUS.CANCELLED);
    assert.equal(await getStock(), 10);
  },
);

test(
  "nominal gross_amount yang tidak cocok ditolak",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({ status: ORDER_STATUS.PENDING, totalAmount: 2000 });
    await setStock(8);

    await assert.rejects(
      () =>
        changeOrderStatus({
          orderId: order.id,
          newStatus: ORDER_STATUS.PAID,
          source: "webhook",
          grossAmount: "1500.00",
        }),
      /nominal/i,
    );

    assert.equal((await getOrder(order.id)).status, ORDER_STATUS.PENDING);
    assert.equal(await getStock(), 8);
  },
);

test(
  "transisi status tidak valid ditolak",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({ status: ORDER_STATUS.COMPLETED });
    await setStock(8);

    await assert.rejects(
      () =>
        changeOrderStatus({
          orderId: order.id,
          newStatus: ORDER_STATUS.PENDING,
          source: "admin",
        }),
      /transisi/i,
    );

    assert.equal((await getOrder(order.id)).status, ORDER_STATUS.COMPLETED);
    assert.equal(await getStock(), 8);
  },
);

test(
  "PROCESSING ke PAID via webhook tidak mengubah stok",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({
      status: ORDER_STATUS.PROCESSING,
      quantity: 2,
      totalAmount: 2000,
    });
    await setStock(8);

    const result = await changeOrderStatus({
      orderId: order.id,
      newStatus: ORDER_STATUS.PAID,
      source: "webhook",
      grossAmount: "2000.00",
    });

    assert.equal(result.order.status, ORDER_STATUS.PAID);
    assert.equal(await getStock(), 8);
  },
);

test(
  "PROCESSING ke FAILED mengembalikan stok",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({
      status: ORDER_STATUS.PROCESSING,
      quantity: 2,
    });
    await setStock(8);

    const result = await changeOrderStatus({
      orderId: order.id,
      newStatus: ORDER_STATUS.FAILED,
      source: "webhook",
    });

    assert.equal(result.order.status, ORDER_STATUS.FAILED);
    assert.equal(await getStock(), 10);
  },
);

test(
  "revert ditolak jika stok tidak mencukupi",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({
      status: ORDER_STATUS.CANCELLED,
      quantity: 2,
    });
    await setStock(1);

    await assert.rejects(
      () =>
        changeOrderStatus({
          orderId: order.id,
          newStatus: ORDER_STATUS.PAID,
          source: "admin",
        }),
      /stok/i,
    );

    assert.equal((await getOrder(order.id)).status, ORDER_STATUS.CANCELLED);
    assert.equal(await getStock(), 1);
  },
);

test(
  "transisi maju PAID ke SHIPPED ke COMPLETED tidak mengubah stok",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({ status: ORDER_STATUS.PAID, quantity: 2 });
    await setStock(8);

    const shipped = await changeOrderStatus({
      orderId: order.id,
      newStatus: ORDER_STATUS.SHIPPED,
      source: "admin",
    });
    const completed = await changeOrderStatus({
      orderId: order.id,
      newStatus: ORDER_STATUS.COMPLETED,
      source: "admin",
    });

    assert.equal(shipped.order.status, ORDER_STATUS.SHIPPED);
    assert.equal(completed.order.status, ORDER_STATUS.COMPLETED);
    assert.equal(await getStock(), 8);
  },
);

test(
  "transisi PENDING ke PROCESSING menyimpan bukti pembayaran",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({ status: ORDER_STATUS.PENDING });

    const result = await changeOrderStatus({
      orderId: order.id,
      newStatus: ORDER_STATUS.PROCESSING,
      source: "user",
      userId,
      requiredStatus: ORDER_STATUS.PENDING,
      paymentProofUrl: "proof_test.png",
    });

    assert.equal(result.order.status, ORDER_STATUS.PROCESSING);
    assert.equal(result.order.payment_proof_url, "proof_test.png");
    assert.ok(result.order.payment_submitted_at);
  },
);

test(
  "upload bukti bayar ditolak jika status bukan PENDING",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({ status: ORDER_STATUS.PROCESSING });

    await assert.rejects(
      () =>
        changeOrderStatus({
          orderId: order.id,
          newStatus: ORDER_STATUS.PROCESSING,
          source: "user",
          userId,
          requiredStatus: ORDER_STATUS.PENDING,
          paymentProofUrl: "proof_test.png",
        }),
      /tidak dalam status PENDING/i,
    );
  },
);

test(
  "jalur admin memakai service yang sama dan mengembalikan stok",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({ status: ORDER_STATUS.PENDING, quantity: 2 });
    await setStock(8);

    const updatedOrder = await paymentService.updateOrderStatus(
      order.id,
      ORDER_STATUS.CANCELLED,
    );

    assert.equal(updatedOrder.status, ORDER_STATUS.CANCELLED);
    assert.equal(await getStock(), 10);
  },
);

test(
  "jalur webhook memakai service yang sama dan idempotent",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({
      status: ORDER_STATUS.PENDING,
      totalAmount: 2000,
    });
    await setStock(8);

    const first = await orderService.updateOrderStatus({
      orderId: order.id,
      targetStatus: ORDER_STATUS.PAID,
      grossAmount: "2000.00",
      source: "webhook",
    });
    const duplicate = await orderService.updateOrderStatus({
      orderId: order.id,
      targetStatus: ORDER_STATUS.PAID,
      grossAmount: "2000.00",
      source: "webhook",
    });

    assert.equal(first.status, ORDER_STATUS.PAID);
    assert.equal(first.already_processed, false);
    assert.equal(duplicate.status, ORDER_STATUS.PAID);
    assert.equal(duplicate.already_processed, true);
    assert.equal(await getStock(), 8);
  },
);

test(
  "jalur webhook menolak nominal yang tidak cocok",
  { skip: !runDbTests },
  async () => {
    const order = await createOrder({
      status: ORDER_STATUS.PENDING,
      totalAmount: 2000,
    });

    await assert.rejects(
      () =>
        orderService.updateOrderStatus({
          orderId: order.id,
          targetStatus: ORDER_STATUS.PAID,
          grossAmount: "999.00",
          source: "webhook",
        }),
      /nominal/i,
    );

    assert.equal((await getOrder(order.id)).status, ORDER_STATUS.PENDING);
  },
);

test("mapTransactionStatus memetakan status gateway yang dikenal", () => {
  assert.equal(mapTransactionStatus("settlement"), ORDER_STATUS.PAID);
  assert.equal(mapTransactionStatus("capture"), ORDER_STATUS.PAID);
  assert.equal(mapTransactionStatus("PAID"), ORDER_STATUS.PAID);
  assert.equal(mapTransactionStatus("pending"), ORDER_STATUS.PENDING);
  assert.equal(mapTransactionStatus("expire"), ORDER_STATUS.CANCELLED);
  assert.equal(mapTransactionStatus("deny"), ORDER_STATUS.CANCELLED);
  assert.equal(mapTransactionStatus("failure"), ORDER_STATUS.FAILED);
});

test("mapTransactionStatus menolak status gateway yang tidak dikenal", () => {
  assert.throws(() => mapTransactionStatus("refund"), /tidak dikenal/i);
  assert.throws(() => mapTransactionStatus(""), /tidak dikenal/i);
});

test("state machine mencakup seluruh pasangan transisi valid dan invalid", () => {
  const expectedTransitions = {
    [ORDER_STATUS.PENDING]: [
      ORDER_STATUS.PROCESSING,
      ORDER_STATUS.PAID,
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.FAILED,
    ],
    [ORDER_STATUS.PROCESSING]: [
      ORDER_STATUS.PAID,
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.FAILED,
    ],
    [ORDER_STATUS.PAID]: [ORDER_STATUS.SHIPPED],
    [ORDER_STATUS.SHIPPED]: [ORDER_STATUS.COMPLETED],
    [ORDER_STATUS.COMPLETED]: [],
    [ORDER_STATUS.CANCELLED]: [ORDER_STATUS.PAID],
    [ORDER_STATUS.FAILED]: [ORDER_STATUS.PAID],
  };

  const allStatuses = Object.values(ORDER_STATUS);

  for (const currentStatus of allStatuses) {
    assert.deepEqual(
      new Set(TRANSITIONS[currentStatus]),
      new Set(expectedTransitions[currentStatus]),
      `transisi dari ${currentStatus} tidak sesuai spesifikasi`,
    );

    for (const newStatus of allStatuses) {
      if (newStatus === currentStatus) {
        assert.equal(
          assertValidTransition(currentStatus, newStatus),
          false,
          `status ${currentStatus} ke dirinya sendiri harus idempotent`,
        );
        continue;
      }

      if (expectedTransitions[currentStatus].includes(newStatus)) {
        assert.equal(
          assertValidTransition(currentStatus, newStatus),
          true,
          `${currentStatus} -> ${newStatus} seharusnya valid`,
        );
      } else {
        assert.throws(
          () => assertValidTransition(currentStatus, newStatus),
          (error) =>
            error.statusCode === 400 && /transisi status tidak valid/i.test(error.message),
          `${currentStatus} -> ${newStatus} seharusnya ditolak`,
        );
      }
    }
  }
});
