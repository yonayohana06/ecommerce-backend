# Analisis Project `ecommerce-backend`

> Tanggal analisis: 8 November 2026
>
> Lingkup: seluruh source code (`src`), migration, konfigurasi deployment, dependency, koneksi database, dan smoke test endpoint read-only.
>
> Status: tidak ada file source code yang diubah dalam proses analisis ini.
>
> **Update 8 November 2026:** database lokal sudah diganti dengan database kosong `fastshop-be` dan seluruh migration berhasil dijalankan. Perbedaan tipe `numeric` pada database lama tidak lagi relevan. Tipe `numeric(12)` (scale 0) adalah keputusan final; **tidak akan dibuat migration ke `numeric(12,2)`**.

## 1. Ringkasan

| Aspek | Kondisi |
|---|---|
| Stack | Node.js, Express 5, PostgreSQL, Supabase Storage, JWT, node-pg-migrate |
| Arsitektur | Layered: Route → Middleware → Controller → Service → Database |
| Autentikasi | JWT terpisah untuk user dan admin, Role-Based Access Control (RBAC) |
| Deployment | Vercel serverless + GitHub Actions untuk migrasi database |
| Status runtime | Server berjalan di port `3001`; database dan Supabase dapat terhubung |
| Kesiapan produksi | **Belum production-ready**, masih level MVP yang cukup rapi |

**Penilaian cepat:** arsitektur **8/10**, keamanan **5/10**, reliabilitas **4/10**, testing **2/10**, dokumentasi **7/10**.

## 2. Metode Verifikasi

- Membaca seluruh source code di `src`, migration, `package.json`, `vercel.json`, dan workflow GitHub Actions.
- Menjalankan `node --check` pada seluruh file JavaScript di `src`.
- Menjalankan `npm audit --omit=dev` dan `npm outdated`.
- Menginspeksi skema database aktual melalui `information_schema`, `pg_constraint`, dan `pg_indexes`.
- Melakukan smoke test endpoint read-only pada server yang berjalan di `http://localhost:3001`.
- Menguji koneksi PostgreSQL dan Supabase.

Hasil verifikasi utama:

- Seluruh file `src` lolos pengecekan sintaks.
- `GET /200`, `GET /api/products`, dan `GET /api/categories` mengembalikan HTTP 200.
- Koneksi PostgreSQL berhasil.
- Supabase RPC `version` berhasil.
- `npm audit` menemukan 8 kerentanan pada dependency produksi.
- Skema database lama tidak sepenuhnya sama dengan file migration; database baru `fastshop-be` sudah dibuat dari migration.

## 3. Yang Sudah Baik

- Pemisahan layer konsisten dan mudah dipahami.
- Semua query menggunakan parameterized query; tidak ditemukan SQL injection langsung.
- Checkout menggunakan transaksi `BEGIN/COMMIT/ROLLBACK` dan `SELECT ... FOR UPDATE`, sehingga mencegah overselling.
- Smart delete produk: soft delete jika produk sudah pernah dibeli, hard delete jika belum.
- Pemisahan secret JWT user dan admin sudah diterapkan.
- Bukti transfer disimpan di private bucket dan diakses melalui signed URL.
- Slug kategori dibuat otomatis, termasuk validasi duplikasi.
- Pagination, filter status, dan sanitasi `limit` sudah ada.
- `.env` tidak ikut ter-commit; tidak ada secret di Git.
- Semua file `src` lolos `node --check`.

## 4. Temuan Prioritas

### 4.1 Kritis

#### 1. Migrasi database tidak sinkron dengan DB aktual

Pada database lama yang terhubung saat analisis awal:

- Tabel `pgmigrations` **tidak ada**, artinya riwayat migrasi node-pg-migrate tidak tercatat.
- Skema aktual berbeda dari file migration:
  - `products.price`, `orders.total_amount`, dan `order_items.price_at_purchase`: migration membuat `numeric(12)` (scale 0), DB lama memakai `numeric(12,2)`.
  - `orders.payment_submitted_at`: migration `timestamptz`, aktual `timestamp without time zone`.
  - `cart_items.created_at/updated_at`: migration `NOT NULL`, aktual nullable.
  - Ada constraint/index tambahan yang tidak ada di migration, misalnya `cart_items_quantity_check`.
- Ada index duplikat/overlap:
  - `idx_products_category` vs `idx_products_category_id`
  - `idx_products_active` vs `idx_products_is_active`
- `npm run migrate:up` secara lokal langsung gagal karena `DATABASE_URL` tidak diset, sementara `.env` hanya berisi `DB_*`.

**Update:** database lama sudah tidak dipakai. Database baru `fastshop-be` dibuat dari kondisi kosong dan seluruh migration berhasil dijalankan, sehingga `pgmigrations` sudah ada dan skema mengikuti file migration. Perbedaan `numeric(12,2)` tidak berlaku karena `numeric(12)` scale 0 adalah keputusan final. Migration `1794119284866_add-integrity-constraints` kemudian menambahkan constraint dan index yang sebelumnya hilang, serta menyelaraskan timestamp `cart_items` menjadi `timestamptz`.

**Dampak (pada DB lama):** instalasi baru dari migration tidak menghasilkan skema yang sama dengan DB lama. Jika `migrate:up` dijalankan pada DB lama, kemungkinan besar gagal karena `order_status` dan tabel-tabel sudah ada. Pipeline CI juga tidak bisa diandalkan. Kondisi ini sudah diperbaiki dengan database baru.

**Rekomendasi:** lakukan baseline migration, buat `pgmigrations` yang menandai migration lama sebagai applied, atau dump skema aktual menjadi baseline baru. Jangan mengedit migration yang sudah pernah dijalankan. Setelah itu, uji `migrate:up` dari database kosong.

#### 2. Sinkronisasi stok di webhook tidak konsisten

- Admin mengubah status lewat `paymentService.updateOrderStatus()` yang sudah menangani pengembalian stok saat `CANCELLED/FAILED`.
- Webhook memanggil `orderService.updateOrderStatus()` yang **hanya mengubah status**, tanpa menyesuaikan stok.

Contoh: gateway mengirim `cancel/expire` → order menjadi `CANCELLED`, tetapi stok produk **tidak dikembalikan**. Sebaliknya, jika order yang sudah cancelled diubah lagi menjadi `PAID` lewat webhook, stok tidak dipotong kembali. Status `transaction_status` yang tidak dikenal juga dipetakan ke `PENDING`, sehingga bisa mengembalikan order `PAID` menjadi `PENDING`.

**Rekomendasi:** satukan seluruh perubahan status ke satu service transaksional, validasi `gross_amount` terhadap `orders.total_amount`, dan gunakan state machine status yang jelas.

**Update 8 November 2026:** sudah diperbaiki. `src/services/orderStatusService.js` menjadi satu-satunya jalur perubahan status untuk admin, webhook, dan upload bukti bayar. Service mengunci order, memvalidasi transisi dan `gross_amount`, menyesuaikan stok, serta idempotent untuk status yang sama. `transaction_status` yang tidak dikenal sekarang ditolak (HTTP 400).

#### 3. Dependency memiliki kerentanan

`npm audit --omit=dev` menemukan **8 kerentanan**: **1 critical, 3 high, 4 moderate**, antara lain:

- `multer` 2.3.0 — DoS pada upload.
- `body-parser`, `proxy-addr`, `qs` — berasal dari Express.
- `node-pg-migrate`/`glob`/`minimatch` — moderate.

Update tersedia: Express `5.3.0`, Multer `2.5.0`, `pg` `8.23.1`, `@supabase/supabase-js` `2.119.0`.

**Rekomendasi:** jalankan `npm update`/`npm audit fix`, lalu audit ulang. Pindahkan `node-pg-migrate` ke `devDependencies` karena hanya dipakai untuk migrasi/CI.

**Update 8 November 2026:** selesai. Versi terpasang: Express `5.3.0`, Multer `2.5.0`, pg `8.23.1`, `@supabase/supabase-js` `2.119.0`. `node-pg-migrate@9.0.0` dipindah ke `devDependencies`, sehingga `npm audit --omit=dev` melaporkan **0 vulnerabilities**. Sisa 4 moderate ada di devDependencies (`glob`/`minimatch` via `node-pg-migrate` dan `nodemon`); belum ada perbaikan tanpa downgrade, diterima karena hanya tooling lokal/CI. `npm ci` dan seluruh 90 test lulus.

### 4.2 Tinggi

#### 4. Tidak ada automated test dan CI hanya menjalankan migrasi

- `package.json` masih berisi `"test": "echo \"Error: no test specified\" && exit 1"`.
- Tidak ada file test sama sekali.
- Workflow GitHub Actions hanya menjalankan migrasi saat push ke `main`; tidak ada test/lint.

**Dampak:** perubahan pada checkout, stok, auth, atau webhook sangat rawan regresi.

**Rekomendasi:** tambahkan integration test dengan `supertest` + database test terpisah, unit test untuk slugify/status mapping, test migrasi dari DB kosong, dan jalankan di CI pada setiap PR.

**Update 8 November 2026:** selesai. Test runner memakai `node:test` + `fetch` (tanpa dependency baru). Tersedia 90 test untuk auth/RBAC, CRUD katalog, cart/checkout, upload bukti bayar, webhook, skema, dan migrasi dari database kosong. `app.js` tidak lagi membuka listener saat diimpor. Database test terpisah dibuat dan dimigrasikan otomatis melalui `scripts/prepare-test-db.js`; test menolak berjalan jika `TEST_DATABASE_URL` sama dengan `DATABASE_URL`. CI baru (`.github/workflows/test.yml`) menjalankan lint, test non-DB, dan test DB dengan coverage pada PR serta push ke `main`/`develop`. Coverage saat ini 76,04% lines, 70,39% branches, 84,17% functions (ambang 60%).

#### 5. Validasi input dan error handling belum konsisten

Bukti dari live server:

```text
GET /api/products?category_id=abc
→ 500 {"error":"invalid input syntax for type integer: \"NaN\""}
```

Masalah lain:

- Banyak controller mengembalikan `error.message` mentah dari database.
- `isNaN(id)` tidak cukup untuk memvalidasi ID integer.
- `addToCart` tidak memvalidasi stok, status aktif produk, atau tipe quantity.
- `createProduct`/`updateProduct` tidak memvalidasi `price`, `stock`, dan `category_id`.
- Malformed JSON mengembalikan **HTML 400**, bukan JSON.
- Route tidak dikenal mengembalikan **HTML 404**, bukan JSON.
- Error Multer tidak ditangani secara khusus.

**Rekomendasi:** gunakan validator seperti Zod/Joi/express-validator, tambahkan global error handler dan JSON 404 handler, serta jangan pernah mengirim pesan error database ke client.

**Update 8 November 2026:** selesai. Validasi memakai `zod@4.6.7` melalui `src/middlewares/validate.js` dan schema di `src/validation/*` untuk auth, produk, kategori, cart, order, pembayaran, dan pagination. ID divalidasi sebagai integer positif. `src/middlewares/errorHandler.js` memetakan error PostgreSQL (`22P02`, `22001`, `22003` → 400; `23505` → 409; `23503`, `23514` → 400), malformed JSON, dan error Multer menjadi JSON 400, serta menyembunyikan detail error tak dikenal di balik 500 generik. Route tidak dikenal sekarang menghasilkan 404 JSON. Seluruh controller meneruskan error ke handler global dan tidak lagi mengirim `error.message` ke client. Test bertambah menjadi 125 dan semuanya lulus; coverage 80,35% lines / 74,07% branches / 86,25% functions. `npm audit --omit=dev` kembali bersih (0 vulnerabilities).

#### 6. Autentikasi rentan enumerasi akun dan brute force

Login membedakan respons:

- Email tidak ada → `404 "Akun tidak ditemukan"`.
- Email ada tetapi bukan admin → `403`.
- Email admin tetapi password salah → `401`.

Ini memungkinkan penyerang mengetahui apakah suatu email terdaftar dan apakah akun tersebut admin. Tidak ada rate limiting pada login/register/webhook/upload.

Selain itu:

- Email tidak dinormalisasi (case-sensitive).
- Password minimal 6 karakter, tanpa batas atas; bcrypt memiliki batas efektif 72 byte.
- Tidak ada refresh token/revocation.
- `verifyAdminToken` memakai fallback ke `JWT_SECRET` jika `ADMIN_JWT_SECRET` tidak ada.

**Rekomendasi:** kembalikan pesan generik `401` untuk semua kegagalan login, normalisasi email, tambahkan rate limit, validasi panjang password, dan fail-fast jika secret wajib tidak diset.

**Update 8 November 2026:** selesai. Login user dan admin sekarang selalu mengembalikan `401` dengan pesan generik `"Kredensial tidak valid."`; bcrypt dummy dipakai untuk email yang tidak dikenal, dan password diperiksa sebelum role. Email dinormalisasi `trim` + lowercase saat register/login dengan unique index `users_email_lower_unique` pada `LOWER(email)`. Registrasi user mewajibkan password minimal 8 karakter, maksimal 72 byte, serta mengandung huruf dan angka. Rate limit in-memory diterapkan pada login, register, webhook, dan upload dengan respons `429` + `Retry-After`. `helmet` aktif, `x-powered-by` dimatikan, environment wajib divalidasi saat startup, `JWT_SECRET`/`ADMIN_JWT_SECRET` wajib berbeda, fallback secret admin dihapus, dan token user/admin wajib memiliki `role` serta `type` yang sesuai. Total test menjadi 148 dan semuanya lulus; coverage 81,54% lines / 76,44% branches / 87,64% functions.

#### 7. Produk nonaktif membuat keranjang macet

`getCartByUser()` memfilter `p.is_active = true`, tetapi `checkout()` mengambil **semua** `cart_items`, termasuk produk yang sudah nonaktif. Jika produk dinonaktifkan saat masih di keranjang:

- Produk tidak terlihat di response cart.
- Checkout gagal dengan pesan “Produk ... sudah tidak aktif”.
- User tidak bisa menghapus item tersebut dari UI karena item tidak ditampilkan.

`addToCart` juga tidak mengecek status aktif maupun stok.

**Rekomendasi:** validasi saat add-to-cart, tampilkan item nonaktif dengan flag, atau hapus otomatis item nonaktif saat GET/checkout.

**Update 8 November 2026:** selesai. `addToCart` memvalidasi produk ada, aktif, dan total quantity (termasuk akumulasi) tidak melebihi stok dalam transaksi dengan `FOR UPDATE`. `GET /api/cart` menampilkan semua item, termasuk yang nonaktif atau stoknya kurang, dengan field `is_available`, `stock`, dan `is_active`; `grand_total` hanya menjumlahkan item yang tersedia. Checkout menolak item tidak tersedia dengan pesan yang menyebut produk dan meminta user menghapusnya dari keranjang. Keputusan bisnis: item nonaktif ditampilkan agar bisa dihapus, bukan dihapus otomatis. Test cart bertambah menjadi 16 kasus dan seluruh suite 152/152 lulus; coverage 81,77% lines / 76,88% branches / 87,71% functions.

#### 8. Upload bukti pembayaran belum cukup aman

- Filter hanya berdasarkan `file.mimetype` dari client, sehingga bisa dipalsukan.
- `image/svg+xml` diterima; SVG bisa menjadi vektor stored XSS saat dibuka langsung.
- Ekstensi file diambil mentah dari `originalname`.
- Upload ke Supabase dilakukan **di dalam transaksi database**. Jika commit gagal, file menjadi orphan; jika upload lambat, koneksi DB tertahan.
- Error Multer tidak ditangani oleh error middleware.

**Rekomendasi:** allowlist `image/jpeg`, `image/png`, `image/webp`; validasi magic bytes; generate nama file aman; upload di luar transaksi DB atau sediakan cleanup; tangani error Multer.

**Update 8 November 2026:** selesai. `uploadMiddleware` hanya menerima `image/jpeg`, `image/png`, dan `image/webp`; SVG dan tipe non-image ditolak 400. `validateImageSignature` memeriksa magic bytes dan menolak file yang isinya tidak cocok dengan MIME dari client. Nama file memakai ekstensi dari MIME terdeteksi, bukan `originalname`. Upload dilakukan di luar transaksi DB; `orderStatusService.changeOrderStatus` mengecek ulang status `PENDING` di dalam transaksi, dan file dihapus dari Storage jika update DB gagal. Error Multer (termasuk `LIMIT_FILE_SIZE`) ditangani global error handler. Test upload bertambah menjadi 19 kasus; seluruh suite 159/159 lulus dengan coverage 82,18% lines / 77,41% branches / 87,91% functions.

#### 9. State machine pesanan tidak divalidasi

Admin dapat mengubah status dari status apa pun ke status apa pun, misalnya `COMPLETED → CANCELLED`, `PAID → PENDING`, atau `PENDING → SHIPPED`. Webhook juga bisa melakukan hal serupa.

Contoh aturan transisi yang disarankan:

```text
PENDING → PROCESSING → PAID → SHIPPED → COMPLETED
PENDING/PROCESSING → CANCELLED/FAILED
```

Tolak transisi di luar aturan tersebut dan catat audit log perubahan status.

**Update 8 November 2026:** selesai. `src/services/orderStatusService.js` menjadi satu-satunya jalur perubahan status untuk admin, webhook, dan upload bukti bayar. Transisi valid: `PENDING → PROCESSING/PAID/CANCELLED/FAILED`, `PROCESSING → PAID/CANCELLED/FAILED`, `PAID → SHIPPED`, `SHIPPED → COMPLETED`, serta revert `CANCELLED/FAILED → PAID`; transisi lain ditolak 400. Perubahan status dan penyesuaian stok berjalan dalam satu transaksi, dan status yang sama bersifat idempotent. Test matriks mencakup seluruh 7×7 pasangan status. Audit log perubahan status masih tercatat sebagai item P2.

#### 10. Pola deployment Vercel kurang cocok dengan kode saat ini

`src/app.js` langsung menjalankan `app.listen()` dan `process.exit(1)` saat module di-import. Di Vercel:

- Listener tidak diperlukan dan bisa mengganggu lifecycle serverless.
- Pengecekan DB saat cold start menambah latency.
- `pg.Pool` default bisa membuka 10 koneksi per instance; berisiko menghabiskan koneksi Supabase.
- **Tidak ada graceful shutdown dan `pool.on("error")`.** **Update 8 November 2026:** selesai; `src/server.js` menangani graceful shutdown dan `src/config/db.js` memakai `pool.on("error")`.

**Rekomendasi:** pisahkan `app.js` (pure Express app) dan `server.js` (listener lokal), gunakan Supabase connection pooler untuk production, batasi `pool.max`, dan tambahkan error handler pool.

**Update 8 November 2026:** selesai. `src/app.js` kini Express app murni tanpa listener; `src/server.js` menangani listen, pengecekan database awal, `SIGTERM`/`SIGINT`, dan penutupan pool. `src/config/db.js` memakai `DB_POOL_MAX` (default 5, maksimal 20), `pool.on("error")`, serta timeout idle/connection. `/health` dan `/ready` tersedia (`/ready` mengembalikan 503 bila database gagal), dan `/200` menjadi alias `/health`. `vercel.json` menetapkan `maxDuration: 30`. README mencantumkan penggunaan Supabase connection pooler untuk production. Test bertambah menjadi 204 dan semuanya lulus.

### 4.3 Sedang

- **Format angka tidak konsisten:** endpoint produk/cart mengembalikan numeric sebagai string (`"1950000.00"`), sedangkan order list/detail mengubahnya menjadi number. Frontend bisa bingung. **Update 8 November 2026:** selesai; `src/utils/serializers.js` menyeragamkan seluruh harga/total menjadi JSON number di product, cart, checkout, order user/admin, webhook, upload bukti bayar, dan dashboard.
- **N+1 signed URL:** setiap order memanggil `createSignedUrl` satu per satu; untuk `limit=100` bisa lambat dan rawan timeout Vercel. Pertimbangkan `createSignedUrls` batch atau cache.
- **Index berlebihan:** ada index duplikat di tabel `products`; bersihkan agar write tidak lambat.
- **Pencarian admin lambat saat data besar:** `CAST(o.id AS TEXT) ILIKE ...` tidak memakai index; pertimbangkan exact match untuk ID numerik.
- **Index `orders(status, created_at)` belum ada:** penting untuk dashboard admin saat order sudah banyak.
- **Dokumentasi tidak akurat:** **Update 8 November 2026:** selesai.
  - README memakai base URL `3000`, kode default `3001`. → diperbaiki menjadi `3001`.
  - README menyebut JWT user 7 hari, `.env` memakai `1d`. → README dan default kode disamakan ke `1d`; admin `8h`.
  - README menyebut HMAC SHA-512, implementasi memakai SHA-512 hash (gaya Midtrans). → dokumentasi diperjelas sebagai SHA-512 hash, bukan HMAC keyed.
  - README menulis `NUMERIC(12)`, DB lama memakai `NUMERIC(12,2)`; DB baru mengikuti migration `NUMERIC(12)` dan scale 0 dipertahankan. → README menegaskan scale 0.
- **Seed admin:** sudah ditambahkan script `npm run seed:admin` pada 8 November 2026; admin pertama (`admin@fastshop.id`) sudah dibuat.
- **Tidak ada `.env.example`:** menyulitkan setup. **Update 8 November 2026:** `.env.example` lengkap ditambahkan dan divalidasi test.
- **Dead code:** `verifyAuthToken` dan `authorize` tidak dipakai; import tidak terpakai di `productService.js` sudah dihapus.
- **Duplikasi:** controller/service produk & kategori publik vs admin hampir sama; pagination logic berulang.
- **Health check `/200`** hanya mengecek Supabase, bukan PostgreSQL utama; sebaiknya ada `/health` dan `/ready`. **Update 8 November 2026:** selesai; `/200` sekarang alias `/health` tanpa RPC Supabase, dan `/ready` menjalankan `SELECT 1` ke PostgreSQL utama.
- **Observabilitas dasar:** **Update 8 November 2026:** selesai.
  - `src/utils/logger.js` (logger JSON terstruktur), `src/middlewares/requestLogger.js` (X-Request-Id + log per respons), dan `src/middlewares/errorHandler.js` (log stack error di server) ditambahkan.
  - `src/server.js` mencatat database connected, server started, shutdown, dan gagal shutdown.
  - Level log diatur lewat `LOG_LEVEL`.
- **`dotenv` versi 17 mencetak pesan promosi di log**; pertimbangkan `dotenv.config({ quiet: true })` atau central config.

## 5. Skema Aktual vs Migration

| Objek | Migration | DB Baru (`fastshop-be`) | Catatan |
|---|---|---|---|
| `pgmigrations` | Ada | 5 migration tercatat di DB lokal | Perlu `npm run migrate:up` untuk menerapkan 2 migration terbaru |
| `products.price` | `numeric(12)` scale 0 | `numeric(12)` scale 0 | Sesuai keputusan; tidak diubah |
| `orders.total_amount` | `numeric(12)` scale 0 | `numeric(12)` scale 0 | Sesuai keputusan; tidak diubah |
| `order_items.price_at_purchase` | `numeric(12)` scale 0 | `numeric(12)` scale 0 | Sesuai keputusan; tidak diubah |
| `orders.payment_submitted_at` | `timestamptz` | `timestamptz` | Sesuai |
| `cart_items.created_at/updated_at` | `timestamptz` | `timestamptz` | Sesuai setelah migration integritas |
| `cart_items.user_id/product_id` | `bigint` | `integer` (migration belum diterapkan) | Teratasi di migration `1794147578012`; selaras dengan `users.id`/`products.id` |
| `users.role` | CHECK user/admin | CHECK user/admin | Teratasi |
| `products.is_active` | `NOT NULL DEFAULT true` | `NOT NULL DEFAULT true` | Teratasi |
| `orders.status` | `NOT NULL DEFAULT PENDING` | `NOT NULL DEFAULT PENDING` | Teratasi |
| `orders(status, created_at)` | Index | Index `idx_orders_status_created` | Teratasi |
| `users.email` | Unique index `LOWER(email)` | Belum diterapkan | Teratasi via migration `1794139640579` |

## 6. Rekomendasi Prioritas

### P0 — Segera

1. **Baseline & perbaiki migrasi:** sinkronkan skema, buat `pgmigrations`, perbaiki timestamp, constraint, dan index duplikat. Pertahankan `numeric(12)` scale 0. *(Sebagian besar sudah dikerjakan melalui migration `1794119284866_add-integrity-constraints`.)*
2. **Perbaiki webhook:** satu jalur transaksi untuk update status + stok, validasi nominal, state machine. *(Sudah dikerjakan melalui `orderStatusService`.)*
3. **Update dependency:** Express, Multer, pg, Supabase; audit ulang.
4. **Tambahkan test + CI:** auth, cart, checkout, webhook, migrasi dari DB kosong.
5. **Global error handler + validasi input:** JSON error konsisten, jangan bocorkan pesan DB.
6. **Hardening auth:** rate limit, pesan login generik, normalisasi email, validasi password.

### P1 — Minggu Ini

- ~~Perbaiki cart untuk produk nonaktif dan validasi add-to-cart.~~ (sudah dikerjakan)
- ~~Hardening upload (allowlist, magic bytes, cleanup).~~ (sudah dikerjakan)
- ~~Pisahkan `app.js` dan `server.js` untuk serverless.~~ (sudah dikerjakan)
- ~~Tambahkan constraint skema dan index yang hilang.~~ (sudah dikerjakan)
- ~~Samakan format numeric di response API.~~ (sudah dikerjakan)
- ~~Update README, tambahkan `.env.example` dan seed script.~~ (sudah dikerjakan)
- ~~Tambahkan `pool.on("error")`, graceful shutdown, `/health`.~~ (sudah dikerjakan)

### P2 — Berikutnya

- Audit log admin, refresh token/revocation.
- Batch signed URL/caching.
- OpenAPI/Swagger.
- Structured logging, metrics, tracing.
- Migrasi bertahap ke TypeScript jika project akan terus berkembang.

## 7. Kesimpulan

Fondasi project ini sudah cukup baik: struktur rapi, SQL aman, checkout transaksional, dan pemisahan auth user/admin sudah benar. Namun, untuk dianggap production-ready, ada tiga hal yang harus dibereskan lebih dulu:

1. **Migrasi database yang tidak sinkron.** *(Sudah diperbaiki; migration integritas dan fresh-install test lulus.)*
2. **Inkonsistensi stok di webhook.** *(Sudah diperbaiki; satu service transaksional untuk admin, webhook, dan upload bukti bayar.)*
3. **Tidak adanya automated test.** *(Sudah diperbaiki; 204 test + CI lint/test/coverage dan migrasi dari database kosong.)*

Setelah itu, hardening keamanan dan perbaikan deployment serverless bisa dilakukan bertahap.
