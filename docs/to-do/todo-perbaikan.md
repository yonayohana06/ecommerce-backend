# To-Do Perbaikan `ecommerce-backend`

> **Untuk pelaksana:** kerjakan berurutan dari P0. Setiap task harus selesai dengan test/verifikasi sebelum lanjut. Gunakan checklist `- [ ]` untuk tracking.
>
> **Sumber temuan:** [`docs/analisa/analisis-project.md`](../analisa/analisis-project.md)
>
> **Keputusan tipe harga:** gunakan `numeric(12)` (scale 0). Jangan membuat migration ke `numeric(12,2)`.

**Goal:** Menutup temuan analisis secara berurutan sehingga backend layak untuk production.

**Architecture:** Tetap menggunakan layered architecture (Route → Middleware → Controller → Service → DB). Perbaikan difokuskan pada migrasi, konsistensi stok, validasi/error handling, keamanan, dan test otomatis.

**Tech Stack:** Node.js 24, Express 5, PostgreSQL 18, Supabase Storage, JWT, node-pg-migrate.

## Global Constraints

- Semua perubahan skema database wajib melalui migration; tidak boleh DDL manual.
- Jangan mengubah kontrak response API tanpa memperbarui README dan test.
- Setiap bug fix wajib disertai regression test.
- Jangan commit secret; gunakan `.env` lokal dan environment variables di deployment.
- Pertahankan Node.js 24 dan Express 5.
- Tipe harga/total menggunakan `numeric(12)` scale 0; jangan ubah ke `numeric(12,2)`.
- Gunakan format error JSON yang konsisten: `{ code, message }`.
- Perubahan status pesanan harus selalu melalui satu service transaksional.

## Review Focus

- Konsistensi tipe `numeric(12)` scale 0 untuk harga/total dan transaksi besar.
- Konsistensi stok saat checkout, pembatalan, dan webhook bersamaan.
- Validasi input kosong, tipe salah, ID tidak valid, dan JSON rusak.
- Batas keamanan token user vs admin.
- Keamanan file upload (MIME spoofing, SVG, file besar).
- Fresh install database dari migration vs database yang sudah berjalan.

## Ringkasan Prioritas

| Prioritas | Jumlah Task | Fokus |
|---|---:|---|
| P0 | 6 | Migrasi, stok webhook, dependency, test/CI, validasi/error, auth |
| P1 | 8 | Cart, upload, state machine, serverless, skema, response, docs, observability |
| P2 | 7 | Signed URL, audit log, OpenAPI, TypeScript, performa, refresh token, cleanup |

---

## P0 — Kritis / Segera

### P0-01: Baseline dan perbaiki migrasi database

**Temuan:** 4.1.1 dan 5 (migrasi tidak sinkron, `pgmigrations` tidak ada, index duplikat).

**Progres:** database baru `fastshop-be` sudah dibuat dan 4 migration berhasil dijalankan pada 8 November 2026; `pgmigrations` sudah berisi 4 record. `DATABASE_URL` sudah ditambahkan ke `.env` dengan `sslmode=disable`, dan `npm run migrate:up` berhasil dijalankan ulang.

**Progres 8 November 2026 (lanjutan):**
- Backup `pg_dump` dibuat sebelum perubahan skema (file 15K di direktori temp).
- Perbandingan skema aktual vs migration selesai; tidak ada index duplikat di DB baru.
- Migration `1794119284866_add-integrity-constraints` ditambahkan: `NOT NULL` untuk `products.is_active` dan `orders.status`, CHECK role/quantity, timestamp `cart_items` → `timestamptz`, dan index `orders(status, created_at)`.
- `migrate:down` satu langkah berhasil mengembalikan skema lama, lalu `migrate:up` menerapkannya kembali.
- `tests/db/schema.test.js` 10/10 lulus, termasuk penolakan data invalid.
- Fresh install kelima migration pada database sementara berhasil; schema test 10/10 lulus, lalu database sementara dihapus.
- Seluruh suite `RUN_DB_TESTS=1 npm test` 23/23 lulus.
- Baseline untuk DB existing/production belum dilakukan karena belum ada akses ke DB tersebut.

**Estimasi:** L (1–2 hari)

**Files:**
- `migrations/*`
- `package.json`
- `.env.example` (buat baru)
- `.github/workflows/deploy.yml`
- `README.md`

**Langkah:**
- [x] Backup database sebelum melakukan perubahan skema.
- [x] Bandingkan skema aktual dengan seluruh migration; catat semua perbedaan.
- [x] Tambahkan dukungan `DATABASE_URL` untuk node-pg-migrate (sudah ditambahkan ke `.env` dengan `sslmode=disable`).
- [ ] Buat strategi baseline:
  - [ ] Untuk DB yang sudah ada: buat tabel `pgmigrations` dan tandai migration lama sebagai sudah applied (belum perlu di lokal; menunggu akses DB production).
  - [x] Untuk fresh install: pastikan seluruh migration dapat dijalankan dari database kosong.
- [x] Buat migration baru untuk menyelaraskan skema:
  - [x] `payment_submitted_at` dan timestamp `cart_items` → `timestamptz` (sudah sesuai di DB baru).
  - [x] Samakan `NOT NULL` dan constraint yang hilang.
  - [x] Hapus index duplikat jika ada: `idx_products_category_id`, `idx_products_is_active` (tidak ditemukan di DB baru).
  - [x] Tambahkan index yang dibutuhkan, misalnya `orders(status, created_at)`.
- [x] **Jangan** mengubah `numeric(12)` menjadi `numeric(12,2)`; scale 0 dipertahankan.
- [x] Uji `npm run migrate:up` pada database kosong.
- [x] Uji `npm run migrate:down` minimal satu langkah pada database test.
- [x] Pastikan migration idempotent/aman untuk DB yang sudah berisi data (backfill NULL sebelum `NOT NULL`).
- [x] Perbarui dokumentasi cara menjalankan migration.

**Definition of Done:**
- [x] `pgmigrations` ada dan mencatat seluruh migration.
- [x] Fresh install dari migration menghasilkan skema yang sama dengan DB aktual.
- [x] `npm run migrate:up` berhasil di DB kosong dan DB existing.
- [x] Tidak ada index duplikat.
- [ ] CI migration berhasil menggunakan database test (dikerjakan bersama P0-04).

**Verifikasi:**
```bash
npm run migrate:up
npm run migrate:down
npm run migrate:up
```

### P0-02: Satukan update status pesanan dan sinkronisasi stok

**Temuan:** 4.1.2 (webhook tidak mengembalikan/memotong stok).

**Estimasi:** M (0.5–1 hari)

**Files:**
- `src/controllers/orderController.js`
- `src/services/orderService.js`
- `src/services/paymentService.js`
- `src/constants/orderStatus.js`
- `src/services/orderStatusService.js` (baru)
- `tests/orders/*`

**Langkah:**
- [ ] Buat satu service transaksional `changeOrderStatus({ orderId, newStatus, source })`.
- [ ] Di dalam service: `BEGIN`, lock order dengan `FOR UPDATE`, validasi transisi, sesuaikan stok, update status, `COMMIT`.
- [ ] Pindahkan logika restock/re-deduct dari `paymentService.updateOrderStatus()` ke service baru.
- [ ] Arahkan endpoint admin dan webhook ke service yang sama.
- [ ] Validasi `gross_amount` dari webhook terhadap `orders.total_amount`.
- [ ] Tolak `transaction_status` yang tidak dikenal; jangan default ke `PENDING`.
- [ ] Pastikan webhook idempotent: status yang sama tidak mengubah stok dua kali.
- [ ] Tambahkan test:
  - [ ] Cancel/expire mengembalikan stok.
  - [ ] Revert dari CANCELLED ke PAID memotong stok kembali.
  - [ ] Webhook duplikat tidak mengubah stok dua kali.
  - [ ] Nominal tidak cocok ditolak.
  - [ ] Transisi tidak valid ditolak.

**Definition of Done:**
- [ ] Tidak ada jalur update status yang melewati service baru.
- [ ] Stok konsisten untuk seluruh transisi.
- [ ] Webhook dan admin menghasilkan perilaku yang sama.
- [ ] Semua test orders/webhook lulus.

**Verifikasi:**
```bash
npm test -- tests/orders
```

### P0-03: Update dependency yang rentan

**Temuan:** 4.1.3 (8 kerentanan: 1 critical, 3 high, 4 moderate).

**Estimasi:** S (1–2 jam)

**Files:**
- `package.json`
- `package-lock.json`

**Langkah:**
- [ ] Jalankan `npm update` untuk Express, Multer, pg, dan Supabase.
- [ ] Jalankan `npm audit fix` jika diperlukan.
- [ ] Pindahkan `node-pg-migrate` ke `devDependencies`.
- [ ] Evaluasi `overrides` untuk `glob`/`minimatch` atau terima risiko moderate karena hanya dipakai CLI/CI.
- [ ] Jalankan `npm ci` dari lockfile baru.
- [ ] Jalankan seluruh test dan smoke test endpoint.

**Definition of Done:**
- [ ] `npm audit --omit=dev` tidak menghasilkan critical/high.
- [ ] Tidak ada breaking change pada API.
- [ ] `npm ci` dan test berhasil.

**Verifikasi:**
```bash
npm audit --omit=dev
npm ci
npm test
```

### P0-04: Tambahkan automated test dan CI

**Temuan:** 4.2.4 (tidak ada test, `npm test` selalu gagal, CI hanya migration).

**Estimasi:** L (2–3 hari)

**Files:**
- `tests/*`
- `package.json`
- `.github/workflows/test.yml` (baru)
- `docker-compose.test.yml` (opsional, untuk PostgreSQL test)
- `jest.config.js` atau konfigurasi test runner yang dipilih

**Langkah:**
- [ ] Pilih test runner: Jest + Supertest (direkomendasikan) atau `node:test`.
- [ ] Siapkan database test terpisah dan jalankan migration sebelum test.
- [ ] Ubah `app.js` agar dapat di-import tanpa menjalankan listener.
- [ ] Tambahkan test minimal:
  - [ ] Register/login user dan admin.
  - [ ] RBAC: user tidak bisa akses endpoint admin dan sebaliknya.
  - [ ] CRUD produk dan kategori.
  - [ ] Add/update/delete cart dan validasi stok.
  - [ ] Checkout sukses, stok berkurang, cart kosong.
  - [ ] Checkout gagal karena stok habis dan rollback.
  - [ ] Upload bukti bayar valid/tidak valid.
  - [ ] Webhook signature valid/tidak valid dan sinkronisasi stok.
  - [ ] Migration dari database kosong.
  - [ ] Invalid input dan error response JSON.
- [ ] Tambahkan script `test`, `test:watch`, dan `test:coverage`.
- [ ] Tambahkan job CI untuk lint + test + migration test pada PR.
- [ ] Tambahkan coverage threshold yang realistis (misalnya 60% untuk memulai).

**Definition of Done:**
- [ ] `npm test` berhasil, bukan placeholder.
- [ ] CI berjalan pada PR dan push.
- [ ] Test migration dari DB kosong berhasil.
- [ ] Tidak ada test yang bergantung pada database production.

**Verifikasi:**
```bash
npm test
npm run test:coverage
```

### P0-05: Validasi input dan global error handling

**Temuan:** 4.2.5 (error DB bocor, `category_id=abc` → 500, HTML 404/400).

**Estimasi:** M (1 hari)

**Files:**
- `src/middlewares/validate.js` (baru)
- `src/middlewares/errorHandler.js` (baru)
- `src/middlewares/notFound.js` (baru)
- `src/validation/*` (baru)
- `src/utils/httpError.js` (baru)
- `src/app.js`
- Seluruh controller terkait

**Langkah:**
- [ ] Tambahkan Zod/Joi untuk validasi body, params, dan query.
- [ ] Buat schema validasi untuk auth, product, category, cart, order, payment, dan pagination.
- [ ] Validasi ID sebagai integer positif (bukan hanya `isNaN`).
- [ ] Tambahkan global error handler:
  - [ ] `22P02`/invalid input → 400.
  - [ ] `23505` duplicate → 409.
  - [ ] `23503` foreign key → 400.
  - [ ] `23514` check constraint → 400.
  - [ ] Error tak dikenal → 500 tanpa detail DB.
- [ ] Tambahkan JSON 404 handler.
- [ ] Tangani error `express.json()` (malformed JSON) sebagai JSON 400.
- [ ] Tangani error Multer (file terlalu besar/tipe salah) sebagai JSON 400.
- [ ] Hapus `error: error.message` dari response production.
- [ ] Tambahkan test untuk semua kasus di atas.

**Definition of Done:**
- [ ] Semua input invalid menghasilkan 400 JSON yang rapi.
- [ ] Tidak ada pesan error database yang sampai ke client.
- [ ] Route tidak dikenal menghasilkan 404 JSON.
- [ ] Malformed JSON menghasilkan 400 JSON.
- [ ] Test validasi dan error handler lulus.

**Verifikasi:**
```bash
curl -i "http://localhost:3001/api/products?category_id=abc"
curl -i -H 'Content-Type: application/json' -d '{bad json' http://localhost:3001/api/auth/login
curl -i http://localhost:3001/api/does-not-exist
```

### P0-06: Hardening autentikasi

**Temuan:** 4.2.6 (enumerasi akun, tanpa rate limit, password policy lemah, fallback secret).

**Estimasi:** M (0.5–1 hari)

**Files:**
- `src/services/authService.js`
- `src/services/adminAuthService.js`
- `src/middlewares/authMiddleware.js`
- `src/middlewares/rateLimit.js` (baru)
- `src/config/env.js` (baru)
- `src/app.js`
- `tests/auth/*`

**Langkah:**
- [ ] Kembalikan pesan generik `401` untuk semua kegagalan login.
- [ ] Lakukan pengecekan password sebelum pengecekan role, atau gunakan pesan/response yang seragam.
- [ ] Normalisasi email menjadi lowercase + trim saat register dan login.
- [ ] Tambahkan unique index `LOWER(email)` atau gunakan `citext`.
- [ ] Validasi format email.
- [ ] Tetapkan panjang password minimal 8 dan maksimal 72 byte; tolak password lemah.
- [ ] Tambahkan rate limit untuk login/register/webhook/upload.
- [ ] Tambahkan `helmet` dan matikan `x-powered-by`.
- [ ] Validasi environment variable wajib saat startup dan fail-fast.
- [ ] Hapus fallback `ADMIN_JWT_SECRET` ke `JWT_SECRET`.
- [ ] Pastikan token user wajib memiliki `role === "user"` dan `type === "user"`.
- [ ] Tambahkan test enumerasi, rate limit, dan pemisahan user/admin.

**Definition of Done:**
- [ ] Email tidak bisa dienumerasi dari status code.
- [ ] Rate limit mengembalikan 429 setelah batas tercapai.
- [ ] Aplikasi gagal start jika secret wajib tidak diset.
- [ ] Token user tidak bisa mengakses endpoint admin dan sebaliknya.
- [ ] Test auth lulus.

**Verifikasi:**
```bash
npm test -- tests/auth
```

---

## P1 — Tinggi

### P1-01: Perbaiki penanganan produk nonaktif di keranjang

**Temuan:** 4.2.7.

**Estimasi:** S–M

**Files:**
- `src/services/cartService.js`
- `src/controllers/cartController.js`
- `src/services/orderService.js`
- `tests/cart/*`

**Langkah:**
- [ ] Validasi produk aktif dan stok saat `addToCart`.
- [ ] Validasi quantity sebagai integer positif.
- [ ] Tampilkan item nonaktif di GET cart dengan flag `is_available`, atau hapus otomatis dari cart.
- [ ] Pastikan checkout tidak gagal karena item tersembunyi.
- [ ] Tambahkan test: produk dinonaktifkan setelah masuk cart, lalu GET/checkout.
- [ ] Tambahkan test quantity melebihi stok dan quantity bukan integer.

**Definition of Done:**
- [ ] User dapat melihat dan menghapus item yang sudah nonaktif.
- [ ] Checkout memberi error yang jelas atau mengabaikan item nonaktif sesuai keputusan bisnis.
- [ ] Test cart lulus.

### P1-02: Hardening upload bukti pembayaran

**Temuan:** 4.2.8.

**Estimasi:** M

**Files:**
- `src/middlewares/uploadMiddleware.js`
- `src/services/paymentService.js`
- `src/controllers/paymentController.js`
- `tests/payment/*`

**Langkah:**
- [ ] Allowlist MIME: `image/jpeg`, `image/png`, `image/webp`.
- [ ] Validasi magic bytes, bukan hanya `mimetype` dari client.
- [ ] Tolak SVG dan file non-image.
- [ ] Gunakan ekstensi berdasarkan MIME yang tervalidasi, bukan `originalname`.
- [ ] Upload ke storage di luar transaksi DB; jika update DB gagal, hapus file.
- [ ] Pastikan order tetap PENDING sebelum update dan re-check di dalam transaksi.
- [ ] Tangani error Multer melalui global error handler.
- [ ] Tambahkan test file valid, file palsu, file terlalu besar, dan SVG.
- [ ] Tambahkan cleanup untuk file orphan.

**Definition of Done:**
- [ ] Hanya JPEG/PNG/WebP valid yang diterima.
- [ ] File berbahaya ditolak dengan 400 JSON.
- [ ] Tidak ada file orphan saat DB gagal.
- [ ] Test upload lulus.

### P1-03: Terapkan state machine status pesanan

**Temuan:** 4.2.9.

**Estimasi:** M

**Files:**
- `src/constants/orderStatus.js`
- `src/services/orderStatusService.js`
- `src/services/paymentService.js`
- `src/controllers/orderController.js`
- `tests/orders/*`

**Langkah:**
- [ ] Definisikan transisi valid:
  - [ ] `PENDING → PROCESSING`
  - [ ] `PROCESSING → PAID`
  - [ ] `PAID → SHIPPED`
  - [ ] `SHIPPED → COMPLETED`
  - [ ] `PENDING/PROCESSING → CANCELLED/FAILED`
- [ ] Tolak transisi lain dengan 400/409.
- [ ] Terapkan aturan yang sama untuk admin dan webhook.
- [ ] Pastikan perubahan status tidak valid tidak mengubah stok.
- [ ] Tambahkan test seluruh transisi valid dan invalid.

**Definition of Done:**
- [ ] Status tidak bisa melompat atau mundur sembarangan.
- [ ] Admin dan webhook memakai aturan yang sama.
- [ ] Test state machine lulus.

### P1-04: Pisahkan entrypoint serverless dan perbaiki koneksi pool

**Temuan:** 4.2.10.

**Estimasi:** M

**Files:**
- `src/app.js`
- `src/server.js` (baru)
- `src/config/db.js`
- `vercel.json`
- `package.json`

**Langkah:**
- [ ] Ubah `src/app.js` menjadi pure Express app tanpa `app.listen()` dan `process.exit()`.
- [ ] Buat `src/server.js` untuk listener lokal dan graceful shutdown.
- [ ] Tambahkan `pool.on("error")`.
- [ ] Batasi `pool.max` melalui env, misalnya default 5.
- [ ] Gunakan Supabase connection pooler untuk production.
- [ ] Tambahkan `/health` (proses hidup) dan `/ready` (cek `SELECT 1`).
- [ ] Hapus atau alias endpoint `/200` yang membingungkan.
- [ ] Tambahkan `maxDuration` untuk endpoint upload di Vercel jika diperlukan.
- [ ] Pastikan `npm start` tetap berjalan lokal.
- [ ] Tambahkan test bahwa import `app.js` tidak membuka listener.

**Definition of Done:**
- [ ] `app.js` dapat di-import untuk test tanpa membuka port.
- [ ] Server lokal berjalan via `server.js`.
- [ ] Pool tidak membuka koneksi berlebihan di serverless.
- [ ] `/health` dan `/ready` berfungsi.

### P1-05: Tambahkan constraint dan bersihkan index database

**Temuan:** 5 (integritas skema).

**Progres:** sebagian besar item sudah dikerjakan melalui migration `1794119284866_add-integrity-constraints` pada 8 November 2026. Sisa: tipe `bigint` untuk `cart_items` dan unique index `LOWER(email)`.

**Estimasi:** M

**Files:**
- `migrations/*` (migration baru)
- `tests/migrations/*`

**Langkah:**
- [x] Set `products.is_active NOT NULL DEFAULT true`.
- [x] Set `orders.status NOT NULL DEFAULT 'PENDING'`.
- [x] Tambahkan `CHECK (role IN ('user', 'admin'))` pada `users.role`.
- [x] Pastikan `CHECK (quantity > 0)` pada `cart_items.quantity`.
- [ ] Selaraskan tipe `cart_items.user_id` dan `product_id` menjadi `bigint`.
- [ ] Tambahkan unique index `LOWER(email)` pada `users.email`.
- [x] Samakan tipe timestamp menjadi `timestamptz`.
- [x] Hapus index duplikat (tidak ditemukan di DB baru).
- [x] Tambahkan index `orders(status, created_at)`.
- [x] Uji migration up/down dan constraint dengan data invalid.

**Definition of Done:**
- [x] Semua constraint aktif dan teruji.
- [x] Tidak ada index duplikat.
- [x] Migration aman untuk data existing (backfill NULL sebelum `NOT NULL`).
- [x] Test migration lulus.

### P1-06: Samakan format numeric di response API

**Temuan:** 4.3 (harga produk/cart berupa string, order berupa number).

**Estimasi:** S–M

**Files:**
- `src/services/productService.js`
- `src/services/cartService.js`
- `src/services/orderService.js`
- `src/services/paymentService.js`
- `src/utils/serializers.js` (baru)
- `README.md`
- `tests/api/*`

**Langkah:**
- [ ] Tentukan kontrak: semua harga, subtotal, dan total dikembalikan sebagai number.
- [ ] Buat serializer `toNumber` yang aman untuk numeric PostgreSQL.
- [ ] Terapkan pada product list/detail, cart, checkout, order list/detail, dan admin order.
- [ ] Pastikan konversi aman untuk nilai Rupiah bulat (`numeric(12)` scale 0).
- [ ] Tambahkan test tipe data response.
- [ ] Perbarui dokumentasi API.

**Definition of Done:**
- [ ] Tipe numeric konsisten di seluruh endpoint.
- [ ] Test response schema lulus.
- [ ] README menjelaskan kontrak angka.

### P1-07: Perbarui dokumentasi, `.env.example`, dan seed admin

**Temuan:** 4.3 (dokumentasi tidak akurat, tidak ada seed/.env.example).

**Estimasi:** S–M

**Files:**
- `README.md`
- `.env.example` (baru)
- `scripts/seed-admin.js` (baru)
- `package.json`

**Langkah:**
- [ ] Perbaiki base URL menjadi `3001`.
- [ ] Samakan masa berlaku JWT dengan `.env` (`1d` user, `8h` admin).
- [ ] Perjelas signature payment gateway: SHA-512 hash, bukan HMAC (atau perbaiki implementasi jika memang HMAC).
- [ ] Pastikan dokumentasi menyebut `NUMERIC(12)` (scale 0) sesuai keputusan.
- [ ] Dokumentasikan `DATABASE_URL` untuk migration.
- [ ] Buat `.env.example` lengkap tanpa secret.
- [x] Buat seed admin dengan `ADMIN_EMAIL`/`ADMIN_PASSWORD`; tolak password default/lemah.
- [x] Tambahkan script `npm run seed:admin`.
- [x] Dokumentasikan cara membuat admin pertama.

**Definition of Done:**
- [ ] Developer baru dapat setup project hanya dari README + `.env.example`.
- [ ] Seed admin berhasil membuat akun admin.
- [ ] Semua nilai dokumentasi sesuai kode.

### P1-08: Tambahkan observability dasar

**Temuan:** 4.3 (tidak ada request logging, request ID, metrics).

**Estimasi:** S–M

**Files:**
- `src/app.js`
- `src/middlewares/requestLogger.js` (baru)
- `src/config/db.js`
- `README.md`

**Langkah:**
- [ ] Tambahkan request logging terstruktur (pino/morgan).
- [ ] Tambahkan request ID per request.
- [ ] Log error dengan stack trace di server, tanpa membocorkan ke client.
- [ ] Tambahkan `/health` dan `/ready`.
- [ ] Tambahkan graceful shutdown (`SIGTERM`/`SIGINT`) yang menutup pool.
- [ ] Opsional: integrasi error tracking (Sentry).

**Definition of Done:**
- [ ] Setiap request memiliki log dan request ID.
- [ ] Error tercatat di server.
- [ ] Health check mencerminkan kondisi DB.
- [ ] Shutdown tidak meninggalkan koneksi menggantung.

---

## P2 — Sedang / Backlog

### P2-01: Batch signed URL dan cache

**Temuan:** N+1 signed URL pada order list.

**Files:** `src/services/paymentService.js`, `src/services/orderService.js`

- [ ] Gunakan `createSignedUrls` batch untuk banyak order.
- [ ] Tambahkan cache in-memory dengan TTL lebih pendek dari masa berlaku signed URL.
- [ ] Pastikan cache tidak menyajikan URL kedaluwarsa.
- [ ] Tambahkan test/mock untuk memastikan jumlah panggilan storage berkurang.

### P2-02: Audit log admin

**Temuan:** Tidak ada jejak perubahan admin.

**Files:** migration baru, service audit, endpoint admin.

- [ ] Buat tabel `audit_logs` (actor, action, entity, before/after, IP, timestamp).
- [ ] Catat perubahan status order, CRUD produk, dan CRUD kategori.
- [ ] Tambahkan endpoint admin untuk melihat audit log dengan pagination.
- [ ] Tambahkan test.

### P2-03: Dokumentasi OpenAPI/Swagger

**Temuan:** Dokumentasi API masih berupa README.

**Files:** `docs/openapi.yaml`, route docs.

- [ ] Dokumentasikan seluruh endpoint, auth, request, response, dan error.
- [ ] Sajikan Swagger UI di environment non-production atau di balik auth.
- [ ] Validasi spec di CI.
- [ ] Tambahkan contoh penggunaan.

### P2-04: Migrasi bertahap ke TypeScript

**Temuan:** Tidak ada type checking.

**Files:** `tsconfig.json`, `types/`, `package.json`.

- [ ] Aktifkan TypeScript dengan `allowJs` terlebih dahulu.
- [ ] Definisikan tipe row database dan response API.
- [ ] Tambahkan `tsc --noEmit` ke CI.
- [ ] Migrasikan service/controller secara bertahap.
- [ ] Pastikan test tetap lulus.

### P2-05: Optimasi performa dan pencarian admin

**Temuan:** Pencarian ID memakai `CAST(... AS TEXT) ILIKE`, count query berulang, data produk besar.

**Files:** `src/services/paymentService.js`, migration index.

- [ ] Gunakan exact match untuk pencarian ID numerik.
- [ ] Tambahkan index `orders(status, created_at)`.
- [ ] Evaluasi count query pada produk/order; pertimbangkan cache atau estimasi.
- [ ] Ukur dengan `EXPLAIN ANALYZE` pada data menyerupai production.
- [ ] Tetapkan target latency endpoint list.

### P2-06: Refresh token dan revocation

**Temuan:** Token tidak dapat dicabut sebelum kedaluwarsa.

**Files:** auth service, middleware, migration session/token version.

- [ ] Tambahkan refresh token dengan rotasi.
- [ ] Tambahkan logout yang mencabut refresh token.
- [ ] Tambahkan mekanisme revoke semua token saat password berubah.
- [ ] Pertimbangkan token version di tabel users.
- [ ] Tambahkan test expiry/revocation.

### P2-07: Code cleanup dan konsistensi

**Temuan:** Dead code, duplikasi, `dotenv` noise, `.gitignore` minim.

**Files:** berbagai file `src`, `.gitignore`.

- [ ] Hapus `verifyAuthToken`/`authorize` jika tidak dipakai, atau gunakan dengan benar.
- [ ] Hapus import `require("../routes/authRoutes")` yang tidak terpakai di `productService.js`.
- [ ] Satukan helper pagination yang berulang.
- [ ] Kurangi duplikasi controller/service produk & kategori publik vs admin.
- [ ] Set `dotenv.config({ quiet: true })` atau gunakan central config.
- [ ] Hapus atau dokumentasikan `SUPABASE_PUBLISHABLE_KEY` yang tidak dipakai.
- [ ] Tambahkan `.DS_Store`, log, dan coverage ke `.gitignore`.
- [ ] Jalankan lint/format sebelum commit.

---

## Urutan Eksekusi yang Disarankan

1. **P0-01** — baseline migrasi agar perubahan berikutnya aman.
2. **P0-03** — update dependency agar test berjalan di versi aman.
3. **P0-04** — test harness dan CI.
4. **P0-02** — perbaikan stok webhook dengan regression test.
5. **P0-05** — validasi dan error handling.
6. **P0-06** — hardening auth.
7. **P1-01 s/d P1-08** secara paralel bila memungkinkan.
8. **P2** setelah P0/P1 stabil.

## Definition of Done Project

- [ ] `npm test` berhasil dan CI berjalan di setiap PR.
- [ ] `npm audit --omit=dev` tanpa critical/high.
- [ ] Migration berhasil dari database kosong.
- [ ] Tidak ada endpoint yang membocorkan error internal.
- [ ] Stok konsisten pada checkout, cancel, dan webhook.
- [ ] Semua endpoint menggunakan validasi input.
- [ ] Dokumentasi sesuai dengan implementasi.
- [ ] Aplikasi dapat berjalan di lokal dan Vercel tanpa masalah lifecycle.
