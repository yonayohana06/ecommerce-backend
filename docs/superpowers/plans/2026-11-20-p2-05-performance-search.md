# P2-05 Performa dan Pencarian Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pencarian admin order memakai exact match untuk ID numerik dan substring email untuk input non-angka, lalu performa daftar pesanan/produk diverifikasi pada 10.000 baris dengan target p95 < 200 ms.

**Architecture:** Perubahan produksi dibatasi pada percabangan `search` di `paymentService.getAllOrdersForAdmin`. Perilaku dikunci dengan test API berbasis database. Pengukuran memakai script benchmark opt-in yang hanya boleh berjalan pada `TEST_DATABASE_URL`, memakai helper percentile yang diuji unit, dan membersihkan data seed berdasarkan prefix unik. Count query tidak diubah kecuali target terukur terlampaui.

**Tech Stack:** Node.js 24, CommonJS, Express 5, PostgreSQL, `node:test`, `pg`; tanpa dependency baru.

**Spec:** `docs/superpowers/specs/2026-11-20-p2-05-performance-search-design.md`

## Global Constraints

- Jangan commit, tag, atau push. Pemilik project meng-commit sendiri; plan ini hanya menyiapkan wording commit di akhir.
- Tidak ada dependency baru. Benchmark memakai `pg` yang sudah terpasang.
- Route, status code, pesan respons, dan bentuk JSON tidak berubah.
- Satu-satunya perubahan perilaku yang disengaja: `search` seluruhnya angka berarti exact ID; `search` bukan angka berarti substring email. Nama user tidak dicari.
- Angka di luar jangkauan `bigint` menghasilkan 200 dengan data kosong, bukan error.
- `.env` tidak boleh dibuat, diubah, atau di-commit.
- TDD untuk kode baru: test harus terlihat gagal sebelum implementasi, lalu hijau.
- Test unit memakai `node --test <path>`; test database memakai file test spesifik dengan `RUN_DB_TESTS=1` atau `npm run test:db`.
- Benchmark hanya boleh berjalan pada `TEST_DATABASE_URL`, menolak `NODE_ENV=production`, dan menolak URL yang sama dengan `DATABASE_URL`.
- Seed benchmark memakai prefix unik dan dibersihkan di blok `finally`; tidak boleh meninggalkan data.
- Target benchmark: 10.000 user, 10.000 order, 10.000 produk; 30 iterasi per skenario; p95 < 200 ms untuk limit 10 dan 100.
- Count query tidak diubah pada iterasi ini. Jika target gagal, berhenti dan laporkan sebelum mengubah query.
- Baseline: working tree setelah P2-07 (belum di-commit), HEAD `df160cf` pada branch `develop`.
- Jangan menerapkan migration ke database lokal/production; P2-05 tidak membuat migration baru.

## Review Focus

1. **Batas angka vs teks:** input kosong/spasi tidak memfilter, leading zero tetap ID, dan input non-angka tidak pernah dibandingkan dengan `orders.id`; test di Task 1.
2. **Overflow bigint:** angka melebihi 9223372036854775807 harus menghasilkan 200 dan data kosong, bukan 500; test di Task 1.
3. **Kombinasi filter:** `status` dan `search` memakai urutan placeholder yang benar dan tidak saling menimpa; test di Task 1.
4. **Email vs angka:** email yang mengandung deretan angka tidak boleh cocok saat search berisi angka yang sama, dan pencarian email harus case-insensitive; test di Task 1.
5. **Keamanan benchmark:** script menolak production/database utama, percentile dihitung benar, data seed dibersihkan, dan exit code non-zero saat target gagal; test helper di Task 2 dan verifikasi eksekusi di Task 2.

---

### Task 1: Semantik pencarian admin order

**Files:**
- Modify: `src/services/paymentService.js:207-218`
- Test: `tests/api/admin-order-search.test.js`

**Interfaces:**
- Consumes: `paymentService.getAllOrdersForAdmin({ status, search, page, limit })` yang sudah ada.
- Produces: perilaku pencarian baru tanpa perubahan signature atau bentuk respons.

- [ ] **Step 1: Tulis test API yang gagal**

```js
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  runDbTests,
  uniqueSuffix,
  startTestServer,
  request,
  registerUser,
  createAdmin,
  loginAdmin,
  createProduct,
  createOrderWithItems,
  cleanup,
  db,
} = require("../helpers/api");

const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);

let closeServer;
let baseUrl;
let adminToken;
let user;
let otherUser;
let order;
let otherOrder;
let product;
let numericToken;
const userIds = [];
const productIds = [];

const searchOrders = (search, suffix = "") =>
  request(
    baseUrl,
    `/api/admin/orders?limit=100&search=${encodeURIComponent(search)}${suffix}`,
    { token: adminToken },
  );

before(async () => {
  if (!runDbTests) return;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;

  const createdAdmin = await createAdmin();
  userIds.push(createdAdmin.admin.id);

  const login = await loginAdmin(baseUrl, createdAdmin.credentials);
  assert.equal(login.status, 200);
  adminToken = login.body.data.token;

  const suffix = uniqueSuffix();

  const registered = await registerUser(baseUrl, {
    email: `search-user-${suffix}@example.com`,
    name: "User Pencarian",
  });
  assert.equal(registered.response.status, 201);
  user = registered.response.body.data;
  userIds.push(user.id);

  const registeredOther = await registerUser(baseUrl, {
    email: `search-other-${suffix}@example.com`,
    name: "User Lain",
  });
  assert.equal(registeredOther.response.status, 201);
  otherUser = registeredOther.response.body.data;
  userIds.push(otherUser.id);

  numericToken = `9${Date.now()}555`;
  const registeredNumeric = await registerUser(baseUrl, {
    email: `${numericToken}@example.com`,
    name: "User Numeric",
  });
  assert.equal(registeredNumeric.response.status, 201);
  userIds.push(registeredNumeric.response.body.data.id);

  product = await createProduct();
  productIds.push(product.id);

  order = await createOrderWithItems({
    userId: user.id,
    productId: product.id,
    status: "PENDING",
  });
  otherOrder = await createOrderWithItems({
    userId: otherUser.id,
    productId: product.id,
    status: "PAID",
  });
  await createOrderWithItems({
    userId: registeredNumeric.response.body.data.id,
    productId: product.id,
  });
});

after(async () => {
  if (!runDbTests) return;

  await cleanup({ userIds, productIds });

  if (closeServer) {
    await closeServer();
  }

  await db.pool.end();
});

dbTest("search angka mencocokkan ID pesanan secara exact", async () => {
  const response = await searchOrders(order.id);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(String(response.body.data[0].order_id), String(order.id));
  assert.equal(response.body.pagination.totalItems, 1);
});

dbTest("search angka dengan leading zero tetap cocok dengan ID", async () => {
  const padded = String(order.id).padStart(12, "0");
  const response = await searchOrders(padded);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(String(response.body.data[0].order_id), String(order.id));
});

dbTest("search non-angka mencocokkan email secara substring", async () => {
  const response = await searchOrders(user.email.toUpperCase());
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.data.map((item) => String(item.order_id)),
    [String(order.id)],
  );
});

dbTest("search non-angka tidak mencocokkan ID", async () => {
  const response = await searchOrders(`id-${order.id}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
});

dbTest("search angka tidak mencocokkan email", async () => {
  const collision = await db.query(
    "SELECT 1 FROM orders WHERE id = $1::bigint",
    [numericToken],
  );
  assert.equal(collision.rowCount, 0);

  const response = await searchOrders(numericToken);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
});

dbTest("search angka di luar bigint mengembalikan 200 dan data kosong", async () => {
  const response = await searchOrders("9223372036854775808");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
  assert.equal(response.body.pagination.totalItems, 0);
});

dbTest("search dapat digabung dengan filter status", async () => {
  const mismatch = await searchOrders(order.id, "&status=PAID");
  assert.equal(mismatch.status, 200);
  assert.deepEqual(mismatch.body.data, []);

  const match = await searchOrders(order.id, "&status=PENDING");
  assert.equal(match.status, 200);
  assert.equal(match.body.data.length, 1);
  assert.equal(String(match.body.data[0].order_id), String(order.id));
});

dbTest("search berisi spasi tidak memfilter hasil", async () => {
  const response = await searchOrders("   ");
  assert.equal(response.status, 200);
  const ids = response.body.data.map((item) => String(item.order_id));
  assert.ok(ids.includes(String(order.id)));
  assert.ok(ids.includes(String(otherOrder.id)));
});
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run:

```bash
RUN_DB_TESTS=1 node --require ./tests/setup.js --test --test-concurrency=1 tests/api/admin-order-search.test.js
```

Expected: FAIL pada test exact/leading zero/numeric-not-email karena kode lama memakai `ILIKE` pada `CAST(o.id AS TEXT)`.

- [ ] **Step 3: Implementasi percabangan search**

Ganti blok `if (search && search.trim() !== "")` di `getAllOrdersForAdmin` menjadi:

```js
if (search && search.trim() !== "") {
  const term = search.trim();

  if (/^\d+$/.test(term)) {
    if (BigInt(term) <= 9223372036854775807n) {
      queryValues.push(term);
      whereClauses.push(`o.id = $${queryValues.length}::bigint`);
    } else {
      whereClauses.push("FALSE");
    }
  } else {
    queryValues.push(`%${term}%`);
    whereClauses.push(`u.email ILIKE $${queryValues.length}`);
  }
}
```

- [ ] **Step 4: Jalankan test dan pastikan lulus**

Run:

```bash
RUN_DB_TESTS=1 node --require ./tests/setup.js --test --test-concurrency=1 tests/api/admin-order-search.test.js
```

Expected: seluruh test PASS.

- [ ] **Step 5: Jalankan suite DB, suite non-DB, dan lint**

Run:

```bash
npm run test:db
npm test
npm run lint
```

Expected: `npm run test:db` 0 fail, `npm test` 0 fail, `npm run lint` mencetak `Lint OK`.

---

### Task 2: Helper dan script benchmark

**Files:**
- Create: `scripts/lib/benchmark.js`
- Test: `tests/scripts/benchmark.test.js`
- Create: `scripts/benchmark-admin-search.js`

**Interfaces:**
- Produces: `percentile(values, p) -> number` (nearest-rank; `0` untuk array kosong).
- Produces: `summarize(durations, targetMs = 200) -> { count, p50, p95, max, passed }`.
- Produces: `resolveBenchmarkDatabaseUrl({ testDatabaseUrl, databaseUrl, nodeEnv }) -> string`;
  melempar error untuk production, URL test kosong, atau URL test sama dengan URL utama.
- Script memakai `summarize` dan `resolveBenchmarkDatabaseUrl`, lalu keluar dengan kode 1 jika ada
  `passed === false`.

- [ ] **Step 1: Tulis unit test yang gagal**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  percentile,
  summarize,
  resolveBenchmarkDatabaseUrl,
} = require("../../scripts/lib/benchmark");

test("percentile memakai nearest-rank pada data tidak terurut", () => {
  assert.equal(percentile([500, 100, 300, 200, 400], 50), 300);
  assert.equal(percentile([500, 100, 300, 200, 400], 95), 500);
  assert.equal(percentile([42], 95), 42);
});

test("percentile mengembalikan 0 untuk data kosong", () => {
  assert.equal(percentile([], 95), 0);
});

test("summarize melaporkan p50 p95 max dan status target", () => {
  assert.deepEqual(summarize([100, 150, 200, 250]), {
    count: 4,
    p50: 150,
    p95: 250,
    max: 250,
    passed: false,
  });
  assert.deepEqual(summarize([100, 120, 180]), {
    count: 3,
    p50: 120,
    p95: 180,
    max: 180,
    passed: true,
  });
});

test("resolveBenchmarkDatabaseUrl menolak target tidak aman", () => {
  assert.throws(
    () =>
      resolveBenchmarkDatabaseUrl({
        testDatabaseUrl: "postgres://test",
        databaseUrl: "postgres://main",
        nodeEnv: "production",
      }),
    /production/i,
  );
  assert.throws(
    () =>
      resolveBenchmarkDatabaseUrl({
        testDatabaseUrl: "",
        databaseUrl: "postgres://main",
        nodeEnv: "test",
      }),
    /TEST_DATABASE_URL/,
  );
  assert.throws(
    () =>
      resolveBenchmarkDatabaseUrl({
        testDatabaseUrl: "postgres://same",
        databaseUrl: "postgres://same",
        nodeEnv: "test",
      }),
    /DATABASE_URL/,
  );
});

test("resolveBenchmarkDatabaseUrl mengembalikan URL test yang aman", () => {
  assert.equal(
    resolveBenchmarkDatabaseUrl({
      testDatabaseUrl: "postgres://test",
      databaseUrl: "postgres://main",
      nodeEnv: "test",
    }),
    "postgres://test",
  );
});
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `node --test tests/scripts/benchmark.test.js`

Expected: FAIL karena `scripts/lib/benchmark.js` belum ada.

- [ ] **Step 3: Implementasi helper**

`percentile` menyalin dan mengurutkan `values`, lalu mengambil elemen ke
`Math.ceil((p / 100) * length) - 1`; array kosong mengembalikan `0`.
`summarize` mengembalikan `{ count, p50, p95, max, passed }` dengan
`passed = count > 0 && p95 < targetMs`.
`resolveBenchmarkDatabaseUrl` melempar error jika `nodeEnv === "production"`, URL test kosong,
atau URL test sama dengan URL utama; selain itu mengembalikan URL test.

- [ ] **Step 4: Jalankan unit test dan pastikan lulus**

Run: `node --test tests/scripts/benchmark.test.js`

Expected: 5/5 PASS.

- [ ] **Step 5: Tulis script benchmark**

Buat `scripts/benchmark-admin-search.js` dengan perilaku:

1. `require("dotenv").config({ quiet: true })`.
2. Panggil `resolveBenchmarkDatabaseUrl` dengan `TEST_DATABASE_URL`, `DATABASE_URL`, dan
   `NODE_ENV`; cetak alasan dan keluar dengan kode 1 bila melempar error.
3. Set `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL`, lalu isi fallback
   `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` dummy sebelum me-require service, agar tidak
   memanggil Supabase saat tidak ada proof URL.
4. Buat prefix unik `bench-<timestamp>-<random>`.
5. Seed 10.000 user (`password` dummy, role default), 10.000 order dengan status bergiliran
   dari 7 nilai `order_status`, dan 10.000 produk yang namanya memuat
   `Benchmark Product <prefix>`. `COMMIT` seed agar terlihat oleh koneksi pool service.
   Jika seed gagal sebelum `COMMIT`, jalankan `ROLLBACK` pada client seed.
6. Jalankan `ANALYZE users, orders, products`.
7. Ambil satu `order.id` dan satu `email` contoh untuk skenario pencarian.
8. Skenario, masing-masing 3 warm-up lalu 30 iterasi:
   - admin order tanpa filter, limit 10 dan 100;
   - admin order `status: "PAID"`, limit 10 dan 100;
   - admin order `search: <sampleOrderId>`, limit 10 dan 100;
   - admin order `search: <sampleEmail>`, limit 10 dan 100;
   - produk admin tanpa filter, limit 10 dan 100;
   - produk admin `search: "Benchmark Product <prefix>"`, limit 10 dan 100.
9. Cetak satu baris per skenario: nama, p50, p95, max, `PASS`/`FAIL` terhadap 200 ms.
10. Cetak `EXPLAIN (ANALYZE, BUFFERS)` untuk query data dan count pada skenario exact ID,
    email, status, dan produk search. Query harus sama dengan yang dipakai service.
11. Di blok `finally`, hapus order milik user berprefix, lalu user berprefix, lalu produk
    berprefix; laporkan kegagalan cleanup; tutup pool.
12. Keluar dengan kode 1 jika ada skenario `FAIL` atau cleanup gagal.

- [ ] **Step 6: Jalankan benchmark penuh dan verifikasi target**

Run: `node scripts/benchmark-admin-search.js`

Expected: 12 skenario `PASS`, p95 < 200 ms, exit code 0, dan output `EXPLAIN` menunjukkan
index dipakai untuk exact ID/status (bukan sequential scan pada tabel besar).

Verifikasi index yang sudah ada:

```bash
node -e "require('dotenv').config({quiet:true}); const {Pool}=require('pg'); const p=new Pool({connectionString:process.env.TEST_DATABASE_URL}); p.query(\"SELECT indexname FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'idx_orders_status_created'\").then((r)=>{console.log(r.rows); return p.end();});"
```

Expected: satu baris `{ indexname: 'idx_orders_status_created' }`.

- [ ] **Step 7: Verifikasi tidak ada data seed tertinggal dan lint**

Run:

```bash
node -e "require('dotenv').config({quiet:true}); const {Pool}=require('pg'); const p=new Pool({connectionString:process.env.TEST_DATABASE_URL}); p.query(\"SELECT COUNT(*)::int AS count FROM users WHERE email LIKE 'bench-%'\").then((r)=>{console.log(r.rows[0].count); return p.end();});"
npm run lint
```

Expected: `0` dan `Lint OK`.

---

### Task 3: Dokumentasi dan verifikasi akhir

**Files:**
- Modify: `docs/openapi.yaml` (deskripsi `AdminOrderSearch`)
- Modify: `README.md:313`
- Modify: `docs/to-do/todo-perbaikan.md` (bagian P2-05)
- Modify: `docs/analisa/analisis-project.md:224-225`
- Modify: `.superpowers/sdd/todo-perbaikan/progress.md` (gitignored)
- Modify: `.superpowers/sdd/2026-11-20-p2-05-performance-search/progress.md` (gitignored)

**Interfaces:**
- Consumes: hasil Task 1 dan angka benchmark Task 2.

- [ ] **Step 1: Perbarui dokumentasi kontrak**

- `docs/openapi.yaml`: deskripsi `AdminOrderSearch` menjadi pencarian ID pesanan exact bila
  input seluruhnya angka, atau substring email case-insensitive bila bukan angka.
- `README.md:313`: ubah keterangan menjadi `pencarian (angka = ID pesanan exact, teks = email user)`.

- [ ] **Step 2: Terapkan keputusan count query berdasarkan hasil benchmark**

Jika seluruh skenario p95 < 200 ms: pertahankan count query dan catat hasilnya.
Jika ada skenario p95 ≥ 200 ms: hentikan pekerjaan, jangan mengubah count query, dan laporkan
skenario yang gagal beserta `EXPLAIN`-nya.

- [ ] **Step 3: Perbarui checklist P2-05**

Di `docs/to-do/todo-perbaikan.md`, centang kelima item P2-05 dan tambahkan
**Progres 20 November 2026** yang memuat:

- exact ID untuk input angka dan substring email untuk input non-angka;
- catatan bahwa index `orders(status, created_at)` sudah ada sejak migration
  `1794119284866_add-integrity-constraints.js`;
- hasil `EXPLAIN ANALYZE` dan p95 aktual pada 10.000 user/order/produk;
- keputusan count query (dipertahankan atau gagal target);
- hasil verifikasi lengkap.

- [ ] **Step 4: Perbarui analisis proyek**

Di `docs/analisa/analisis-project.md`:

- bullet `Pencarian admin lambat saat data besar` ditandai selesai dengan tanggal
  20 November 2026 dan semantik pencarian baru;
- bullet `Index orders(status, created_at) belum ada` dikoreksi karena index sudah ada;
- tambahkan hasil pengukuran p95 dan keputusan count query.

- [ ] **Step 5: Jalankan verifikasi lengkap**

```bash
npm test
npm run test:db
npm run test:coverage
npm run lint
npm run docs:validate
npm audit --omit=dev
git diff --check
```

Expected:

- `npm test`: 0 fail.
- `npm run test:db`: seluruh test lulus.
- `npm run test:coverage`: ambang 60% lines/branches/functions terpenuhi.
- `npm run lint`: `Lint OK`.
- `npm run docs:validate`: `OpenAPI valid`.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `git diff --check`: bersih.

- [ ] **Step 6: Catat hasil aktual dan wording commit**

Perbarui dokumentasi dengan jumlah test, coverage, dan p95 aktual. Siapkan wording commit
untuk pemilik project, contoh:

```text
perf: use exact ID search for admin orders and benchmark list endpoints

- Search numeric input by exact order ID and text input by email substring
- Add DB regression tests for search semantics and bigint overflow
- Add opt-in 10k-row benchmark with p95 target for order/product lists
- Document measured latency, EXPLAIN plans, and count query decision
```

Jangan menjalankan `git commit`.

---

## Catatan Eksekusi

- Task 1 harus selesai dan suite DB hijau sebelum benchmark dianggap valid.
- Jika benchmark gagal karena `TEST_DATABASE_URL` tidak tersedia, catat sebagai blocker
  lingkungan, bukan kegagalan kode.
- Script benchmark memakai data seed yang di-commit sementara; cleanup wajib diverifikasi.
- Jangan menambah index baru hanya karena melihat sequential scan kecil pada dataset sintetis;
  catat dan diskusikan terlebih dahulu.
