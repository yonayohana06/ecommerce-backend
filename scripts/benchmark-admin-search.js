require("dotenv").config({ quiet: true });

const {
  summarize,
  resolveBenchmarkDatabaseUrl,
} = require("./lib/benchmark");

const TARGET_MS = 200;
const ITERATIONS = 30;
const WARMUP_ITERATIONS = 3;
const SEED_COUNT = 10000;
const ORDER_STATUSES = [
  "PENDING",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
];

let db;
let testDatabaseUrl;

function formatRow(name, result) {
  const status = result.passed ? "PASS" : "FAIL";
  return `${status} ${name}: p50=${result.p50.toFixed(2)}ms p95=${result.p95.toFixed(2)}ms max=${result.max.toFixed(2)}ms`;
}

async function timeScenario(name, run) {
  for (let index = 0; index < WARMUP_ITERATIONS; index += 1) {
    await run();
  }

  const durations = [];

  for (let index = 0; index < ITERATIONS; index += 1) {
    const start = process.hrtime.bigint();
    await run();
    durations.push(Number(process.hrtime.bigint() - start) / 1e6);
  }

  const result = summarize(durations, TARGET_MS);

  console.log(formatRow(name, result));

  return { name, ...result };
}

async function printExplain(label, query, values) {
  const statement = query.replace(/;\s*$/, "");
  const result = await db.query(
    `EXPLAIN (ANALYZE, BUFFERS) ${statement}`,
    values,
  );

  console.log(`\nEXPLAIN ${label}`);
  for (const row of result.rows) {
    console.log(row["QUERY PLAN"]);
  }
}

async function cleanup(prefix) {
  const failures = [];
  const emailPattern = `bench-${prefix}-%`;
  const productPattern = `Benchmark Product ${prefix} %`;
  const steps = [
    {
      label: "orders",
      query:
        "DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)",
      values: [emailPattern],
    },
    {
      label: "users",
      query: "DELETE FROM users WHERE email LIKE $1",
      values: [emailPattern],
    },
    {
      label: "products",
      query: "DELETE FROM products WHERE name LIKE $1",
      values: [productPattern],
    },
  ];

  for (const step of steps) {
    try {
      const result = await db.query(step.query, step.values);
      console.log(`Cleanup ${step.label}: ${result.rowCount} baris dihapus`);
    } catch (error) {
      failures.push(`${step.label}: ${error.message}`);
      console.error(`Cleanup ${step.label} gagal: ${error.message}`);
    }
  }

  try {
    const leftover = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM users WHERE email LIKE $1) AS users,
         (SELECT COUNT(*)::int FROM products WHERE name LIKE $2) AS products`,
      [emailPattern, productPattern],
    );
    const { users, products } = leftover.rows[0];

    if (users !== 0 || products !== 0) {
      failures.push(
        `sisa data seed: ${users} user, ${products} produk masih ada`,
      );
    } else {
      console.log("Cleanup terverifikasi: 0 user dan 0 produk tersisa");
    }
  } catch (error) {
    failures.push(`verifikasi cleanup: ${error.message}`);
  }

  return failures;
}

async function seed(prefix) {
  const client = await db.pool.connect();
  const emailPattern = `bench-${prefix}-%`;

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO users (name, email, password)
       SELECT 'Benchmark User ' || series,
              $1 || series || '@example.com',
              'benchmark-password'
       FROM generate_series(1, $2::int) AS series`,
      [`bench-${prefix}-`, SEED_COUNT],
    );

    await client.query(
      `INSERT INTO orders (user_id, total_amount, status, shipping_address, created_at)
       SELECT u.id,
              10000,
              (ARRAY[${ORDER_STATUSES.map((status) => `'${status}'`).join(", ")}])[1 + (u.id % 7)::int]::order_status,
              'Benchmark Address',
              CURRENT_TIMESTAMP - ((u.id % 10000)::int * INTERVAL '1 minute')
       FROM users u
       WHERE u.email LIKE $1`,
      [emailPattern],
    );

    await client.query(
      `INSERT INTO products (name, price, stock, is_active)
       SELECT 'Benchmark Product ' || $1 || ' ' || series,
              10000,
              10,
              TRUE
       FROM generate_series(1, $2::int) AS series`,
      [prefix, SEED_COUNT],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await db.query("ANALYZE users");
  await db.query("ANALYZE orders");
  await db.query("ANALYZE products");
}

async function main() {
  const { paymentService, productService } = (() => {
    testDatabaseUrl = resolveBenchmarkDatabaseUrl({
      testDatabaseUrl: process.env.TEST_DATABASE_URL,
      databaseUrl: process.env.DATABASE_URL,
      nodeEnv: process.env.NODE_ENV,
    });

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.SUPABASE_URL ||= "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= "benchmark-service-role-key";

    return {
      paymentService: require("../src/services/paymentService"),
      productService: require("../src/services/productService"),
    };
  })();

  db = require("../src/config/db");

  const prefix = `bench-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  let cleanupFailures = [];

  console.log(`Seed ${SEED_COUNT} user, ${SEED_COUNT} order, ${SEED_COUNT} produk...`);

  try {
    await seed(prefix);

    const sample = await db.query(
      `SELECT o.id, u.email
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE u.email LIKE $1
       ORDER BY o.id
       LIMIT 1`,
      [`bench-${prefix}-%`],
    );

    if (sample.rowCount === 0) {
      throw new Error("Seed tidak menghasilkan order contoh");
    }

    const sampleOrderId = sample.rows[0].id;
    const sampleEmail = sample.rows[0].email;
    const productSearch = `Benchmark Product ${prefix}`;

    console.log(`Contoh order ID: ${sampleOrderId}`);
    console.log(`Contoh email: ${sampleEmail}`);

    const scenarios = [];

    for (const limit of [10, 100]) {
      scenarios.push(
        {
          name: `admin orders tanpa filter limit ${limit}`,
          run: () =>
            paymentService.getAllOrdersForAdmin({ page: 1, limit }),
        },
        {
          name: `admin orders status PAID limit ${limit}`,
          run: () =>
            paymentService.getAllOrdersForAdmin({
              status: "PAID",
              page: 1,
              limit,
            }),
        },
        {
          name: `admin orders search ID limit ${limit}`,
          run: () =>
            paymentService.getAllOrdersForAdmin({
              search: String(sampleOrderId),
              page: 1,
              limit,
            }),
        },
        {
          name: `admin orders search email limit ${limit}`,
          run: () =>
            paymentService.getAllOrdersForAdmin({
              search: sampleEmail,
              page: 1,
              limit,
            }),
        },
        {
          name: `admin products tanpa filter limit ${limit}`,
          run: () => productService.getProductsAdmin({ page: 1, limit }),
        },
        {
          name: `admin products search limit ${limit}`,
          run: () =>
            productService.getProductsAdmin({
              search: productSearch,
              page: 1,
              limit,
            }),
        },
      );
    }

    console.log(`\nBenchmark: ${WARMUP_ITERATIONS} warm-up, ${ITERATIONS} iterasi, target p95 < ${TARGET_MS}ms\n`);

    const results = [];

    for (const scenario of scenarios) {
      results.push(await timeScenario(scenario.name, scenario.run));
    }

    const orderSelect = `SELECT
      o.id AS order_id, o.user_id, u.email, u.name as user_name,
      o.total_amount, o.status, o.shipping_address,
      o.payment_proof_url, o.payment_submitted_at,
      o.created_at, o.updated_at
    FROM orders o
    JOIN users u ON o.user_id = u.id`;
    const orderCount = `SELECT COUNT(*)
    FROM orders o
    JOIN users u ON o.user_id = u.id`;
    const orderSuffix = `ORDER BY o.created_at DESC
    LIMIT 10 OFFSET 0`;
    const productSelect = `SELECT
      p.id,
      p.name,
      p.price,
      p.stock,
      p.is_active,
      p.image_url,
      c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id`;
    const productCount = `SELECT COUNT(p.id) as total
    FROM products p`;

    await printExplain(
      "orders exact ID (data)",
      `${orderSelect} WHERE o.id = $1::bigint ${orderSuffix}`,
      [sampleOrderId],
    );
    await printExplain(
      "orders exact ID (count)",
      `${orderCount} WHERE o.id = $1::bigint`,
      [sampleOrderId],
    );
    await printExplain(
      "orders email (data)",
      `${orderSelect} WHERE u.email ILIKE $1 ${orderSuffix}`,
      [`%${sampleEmail}%`],
    );
    await printExplain(
      "orders email (count)",
      `${orderCount} WHERE u.email ILIKE $1`,
      [`%${sampleEmail}%`],
    );
    await printExplain(
      "orders status (data)",
      `${orderSelect} WHERE o.status = $1::order_status ${orderSuffix}`,
      ["PAID"],
    );
    await printExplain(
      "orders status (count)",
      `${orderCount} WHERE o.status = $1::order_status`,
      ["PAID"],
    );
    await printExplain(
      "products search (data)",
      `${productSelect} WHERE p.name ILIKE $1 ORDER BY p.id DESC LIMIT 10 OFFSET 0`,
      [`%${productSearch}%`],
    );
    await printExplain(
      "products search (count)",
      `${productCount} WHERE p.name ILIKE $1`,
      [`%${productSearch}%`],
    );

    const failed = results.filter((result) => !result.passed);

    if (failed.length > 0) {
      console.error(`\n${failed.length} skenario melewati target ${TARGET_MS}ms`);
      process.exitCode = 1;
    } else {
      console.log(`\nSemua ${results.length} skenario memenuhi target p95 < ${TARGET_MS}ms`);
    }
  } finally {
    if (db) {
      cleanupFailures = await cleanup(prefix);
    }
  }

  if (cleanupFailures.length > 0) {
    console.error(`\nCleanup gagal: ${cleanupFailures.join("; ")}`);
    process.exitCode = 1;
  }

  if (db) {
    await db.pool.end();
  }
}

main().catch(async (error) => {
  console.error(`Benchmark gagal: ${error.message}`);

  if (db) {
    try {
      await db.pool.end();
    } catch (closeError) {
      console.error(`Gagal menutup pool: ${closeError.message}`);
    }
  }

  process.exitCode = 1;
});
