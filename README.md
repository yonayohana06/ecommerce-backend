# E-Commerce Backend Service

RESTful API backend untuk platform e-commerce modern berbasis Node.js, Express.js (v5), PostgreSQL, dan Supabase Storage. Layanan ini mencakup sistem autentikasi JWT dengan Role-Based Access Control (RBAC), manajemen produk dan kategori (publik & admin), keranjang belanja dinamis, checkout transaksi database dengan *row-level locking*, verifikasi bukti transfer manual via *signed URL*, serta integrasi webhook payment gateway.

---

## 🏗️ Struktur Proyek

Aplikasi ini menggunakan pola **Layered Architecture** (Route ➔ Middleware ➔ Controller ➔ Service ➔ Database) untuk memisahkan logika aplikasi secara modular dan rapi:

```text
ECOMMERCE-BACKEND/
├── .github/
│   └── workflows/
│       └── deploy.yml                # CI/CD: Otomatisasi migrasi database ke Supabase/Production
├── migrations/                       # Skrip migrasi DDL database (node-pg-migrate)
│   ├── ..._init-ecommerce-schema.js
│   ├── ..._add-role-to-users.js
│   ├── ..._table-cart-items.js
│   └── ..._add-payment-proof-to-orders.js
├── src/
│   ├── config/
│   │   ├── db.js                     # Pool koneksi database PostgreSQL (pg)
│   │   └── supabase.js               # Client Supabase Storage untuk upload file bukti transfer
│   ├── constants/
│   │   └── orderStatus.js            # Enum status pesanan (PENDING, PAID, PROCESSING, dll)
│   ├── controllers/
│   │   ├── adminAuthController.js    # Autentikasi dan login khusus administrator
│   │   ├── adminCategoryController.js # Manajemen kategori oleh admin (CRUD)
│   │   ├── adminProductController.js  # Manajemen produk oleh admin (CRUD + Smart Delete)
│   │   ├── authController.js         # Registrasi dan login user biasa
│   │   ├── cartController.js         # Manajemen keranjang belanja pengguna
│   │   ├── categoryController.js     # Katalog kategori publik
│   │   ├── orderController.js        # Checkout pesanan & webhook pembayaran
│   │   ├── paymentController.js      # Upload bukti bayar & manajemen order admin
│   │   └── productController.js      # Katalog & detail produk publik
│   ├── middlewares/
│   │   ├── authMiddleware.js         # Token verification (verifyUserToken, verifyAdminToken, verifyAuthToken, RBAC)
│   │   ├── uploadMiddleware.js       # Konfigurasi Multer memory storage (gambar, maks 2MB)
│   │   └── verifySignature.js        # Verifikasi HMAC SHA-512 signature payment gateway
│   ├── routes/
│   │   ├── adminAuthRoutes.js        # Endpoint auth admin (/api/admin/auth)
│   │   ├── adminCategoryRoutes.js    # Endpoint admin kategori (/api/admin/categories)
│   │   ├── adminProductRoutes.js     # Endpoint admin produk (/api/admin/products)
│   │   ├── authRoutes.js             # Endpoint autentikasi user (/api/auth)
│   │   ├── cartRoutes.js             # Endpoint keranjang belanja (/api/cart)
│   │   ├── categoryRoutes.js         # Endpoint kategori publik (/api/categories)
│   │   ├── index.js                  # Agregator router utama
│   │   ├── orderRoutes.js            # Endpoint transaksi pesanan & webhook (/api/orders)
│   │   ├── paymentRoutes.js          # Endpoint bukti bayar & pesanan admin (/api)
│   │   └── productRoutes.js          # Endpoint produk publik (/api/products)
│   ├── services/
│   │   ├── adminAuthService.js       # Logika auth admin, token khusus admin
│   │   ├── authService.js            # Hashing Bcrypt, otentikasi user, pembuatan JWT
│   │   ├── cartService.js            # Logika keranjang belanja (Upsert & validasi stok)
│   │   ├── categoryService.js        # Logika kategori, auto-slugify, pencegahan duplikasi
│   │   ├── orderService.js           # Transaksi checkout ACID & FOR UPDATE row locking
│   │   ├── paymentService.js         # Upload ke Supabase Storage, Signed URL, sinkronisasi stok
│   │   └── productService.js         # Filter produk, ILIKE search, pagination, soft/hard delete
│   └── app.js                        # Entry point server Express & inisialisasi koneksi DB
├── .env                              # Variabel lingkungan/environment (tidak di-commit)
├── .gitignore
├── package-lock.json
├── package.json
└── vercel.json                       # Konfigurasi deployment serverless Vercel
```

---

## 🛡️ Aturan Keamanan & Otentikasi

### 1. Pemisahan Autentikasi Pengguna & Administrator
Sistem memisahkan secara ketat alur autentikasi dan otorisasi antara **Pelanggan Biasa** dan **Administrator**:
* **Portal Pelanggan (`/api/auth`)**:
  * Pendaftaran publik (`/register`) otomatis menetapkan `role: 'user'`.
  * Login pelanggan (`/login`) menolak akun dengan `role: 'admin'` (`403 Forbidden`) agar admin tidak dapat login di portal belanja pelanggan.
  * Token ditandatangani dengan `JWT_SECRET` (default durasi: **7 hari**).
  * Proteksi endpoint pelanggan menggunakan middleware `verifyUserToken`.
* **Portal Administrator (`/api/admin/auth`)**:
  * **Tidak memiliki endpoint registrasi publik**. Akun admin dibuat secara internal (seeder/CLI/database).
  * Login admin (`/login`) **wajib memiliki `role: 'admin'`**; user biasa yang mencoba login akan langsung ditolak (`403 Forbidden`).
  * Token ditandatangani dengan `ADMIN_JWT_SECRET` (default durasi lebih singkat: **8 jam** demi keamanan).
  * Proteksi endpoint admin menggunakan middleware `verifyAdminToken`.
* Password dienkripsi dengan algoritma **Bcrypt** (salt rounds = 10).
* Token dikirim melalui HTTP Header:
  ```http
  Authorization: Bearer <your_jwt_token>
  ```

### 2. Payment Gateway Webhook Security
* Endpoint webhook pembayaran terpisah dari sistem autentikasi user.
* Keamanan request webhook diproteksi oleh `verifySignature.js` menggunakan algoritma **HMAC SHA-512** dengan memadukan `order_id`, `status_code`, `gross_amount`, dan `PAYMENT_SERVER_KEY`.

### 3. Keamanan File Bukti Pembayaran (Private Storage)
* Bukti transfer disimpan di bucket privat Supabase (`payment-proofs`).
* Akses file oleh admin diberikan secara aman melalui **Signed URL** temporer yang kedaluwarsa setelah 60 menit (3600 detik).

### 4. Proteksi Konkurensi Database (ACID & Row Locking)
* Pada saat checkout (`orderService.checkout`), proses dibungkus dalam transaksi database (`BEGIN ... COMMIT / ROLLBACK`).
* Menggunakan `SELECT ... FOR UPDATE OF p` untuk mengunci baris produk guna mencegah *race condition* dan *overselling* stok ketika banyak user checkout produk yang sama secara bersamaan.

---

## 🗄️ Skema Tabel Database (PostgreSQL)

### 1. `users`
| Column | Type | Constraints | Deskripsi |
| :--- | :--- | :--- | :--- |
| `id` | BIGSERIAL | PRIMARY KEY | ID unik pengguna |
| `name` | VARCHAR(100) | NOT NULL | Nama lengkap pengguna |
| `email` | VARCHAR(150) | UNIQUE, NOT NULL | Email login pengguna |
| `password` | VARCHAR(255) | NOT NULL | Hash password (Bcrypt) |
| `phone_number` | VARCHAR(20) | NULL | Nomor telepon pengguna |
| `role` | VARCHAR(20) | NOT NULL, DEFAULT 'user' | Peran akun (`'user'` atau `'admin'`) |
| `created_at` | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Waktu akun dibuat |
| `updated_at` | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Waktu akun diperbarui |

### 2. `categories`
| Column | Type | Constraints | Deskripsi |
| :--- | :--- | :--- | :--- |
| `id` | SERIAL | PRIMARY KEY | ID unik kategori |
| `name` | VARCHAR(100) | NOT NULL | Nama kategori |
| `slug` | VARCHAR(100) | UNIQUE, NOT NULL | Slug URL-friendly |
| `icon_url` | TEXT | NULL | URL icon atau gambar kategori |
| `created_at` | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Waktu kategori dibuat |

### 3. `products`
| Column | Type | Constraints | Deskripsi |
| :--- | :--- | :--- | :--- |
| `id` | BIGSERIAL | PRIMARY KEY | ID unik produk |
| `category_id` | INT | FOREIGN KEY (`categories.id`), ON DELETE SET NULL | Relasi ke kategori |
| `name` | VARCHAR(200) | NOT NULL | Nama produk |
| `description` | TEXT | NULL | Deskripsi detail produk |
| `price` | NUMERIC(12) | NOT NULL, CHECK (price >= 0) | Harga jual produk |
| `stock` | INT | NOT NULL, DEFAULT 0, CHECK (stock >= 0) | Jumlah stok tersedia |
| `image_url` | TEXT | NULL | URL foto produk |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT TRUE | Status keaktifan produk |
| `created_at` | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Waktu produk dibuat |
| `updated_at` | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Waktu produk diperbarui |
* *Index:* B-Tree (`category_id`, `is_active`) dan GIN Trigram Index (`idx_products_name_trgm` via ekstensi `pg_trgm`).

### 4. `cart_items`
| Column | Type | Constraints | Deskripsi |
| :--- | :--- | :--- | :--- |
| `id` | SERIAL | PRIMARY KEY | ID item keranjang |
| `user_id` | INT | FOREIGN KEY (`users.id`), ON DELETE CASCADE | Pemilik keranjang |
| `product_id` | INT | FOREIGN KEY (`products.id`), ON DELETE CASCADE | Produk yang dimasukkan |
| `quantity` | INT | NOT NULL, DEFAULT 1 | Jumlah kuantitas produk |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Waktu item ditambahkan |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Waktu item diubah |
* *Constraint Unik:* `UNIQUE (user_id, product_id)` untuk mendukung operasi Upsert.

### 5. `orders`
| Column | Type | Constraints | Deskripsi |
| :--- | :--- | :--- | :--- |
| `id` | BIGSERIAL | PRIMARY KEY | ID pesanan |
| `user_id` | BIGINT | FOREIGN KEY (`users.id`), ON DELETE RESTRICT | ID pembeli |
| `total_amount` | NUMERIC(12) | NOT NULL, DEFAULT 0 | Total nilai belanjaan |
| `status` | order_status | DEFAULT 'PENDING' | Status enum transaksi |
| `shipping_address` | TEXT | NOT NULL | Alamat pengiriman barang |
| `payment_proof_url` | TEXT | NULL | Nama/path file bukti transfer |
| `payment_submitted_at` | TIMESTAMPTZ | NULL | Waktu upload bukti bayar |
| `created_at` | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Waktu pesanan dibuat |
| `updated_at` | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Waktu pesanan diperbarui |
* *Nilai Enum `order_status`:* `'PENDING'`, `'PROCESSING'`, `'PAID'`, `'SHIPPED'`, `'COMPLETED'`, `'CANCELLED'`, `'FAILED'`.

### 6. `order_items`
| Column | Type | Constraints | Deskripsi |
| :--- | :--- | :--- | :--- |
| `id` | BIGSERIAL | PRIMARY KEY | ID item pesanan |
| `order_id` | BIGINT | FOREIGN KEY (`orders.id`), ON DELETE CASCADE | Relasi ke header pesanan |
| `product_id` | BIGINT | FOREIGN KEY (`products.id`), ON DELETE RESTRICT | Relasi ke produk |
| `quantity` | INT | NOT NULL, CHECK (quantity > 0) | Jumlah produk dibeli |
| `price_at_purchase` | NUMERIC(12) | NOT NULL, CHECK (price_at_purchase >= 0) | Snapshot harga saat transaksi |
| `created_at` | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Waktu pencatatan item |

---

## 🚀 Endpoint API Utama

Base URL: `http://localhost:3000/api`

### 🔐 1. Autentikasi Pengguna — `/api/auth`
| Method | Endpoint | Akses | Deskripsi |
| :---: | :--- | :---: | :--- |
| `POST` | `/api/auth/register` | Publik | Mendaftarkan akun pelanggan baru (nama, email unik, password min. 6 karakter). |
| `POST` | `/api/auth/login` | Publik | Login pelanggan (menolak akun admin), mengembalikan JWT User token (7 hari) dan profil. |
| `GET` | `/api/auth/me` | User | Mengambil data profil pelanggan yang sedang login. |

### 🛠️ 2. Autentikasi Administrator — `/api/admin/auth`
| Method | Endpoint | Akses | Deskripsi |
| :---: | :--- | :---: | :--- |
| `POST` | `/api/admin/auth/login` | Publik (Admin) | Login administrator (wajib role `admin`), mengembalikan JWT Admin token (8 jam) dan profil. |
| `GET` | `/api/admin/auth/me` | Admin | Mengambil data profil administrator yang sedang login. |

### 📦 3. Katalog Produk (Publik) — `/api/products`
| Method | Endpoint | Akses | Deskripsi |
| :---: | :--- | :---: | :--- |
| `GET` | `/api/products` | Publik | Mengambil daftar produk aktif dengan filter `category_id`, `search` (ILIKE), dan pagination (`page`, `limit`). |
| `GET` | `/api/products/:id` | Publik | Mengambil detail spesifik produk aktif beserta nama kategori. |

### 🛠️ 4. Manajemen Produk (Admin) — `/api/admin/products`
| Method | Endpoint | Akses | Deskripsi |
| :---: | :--- | :---: | :--- |
| `GET` | `/api/admin/products` | Admin | Mengambil semua produk (aktif maupun non-aktif) dengan filter dan pagination. |
| `GET` | `/api/admin/products/:id` | Admin | Mengambil detail produk untuk admin. |
| `POST` | `/api/admin/products` | Admin | Menambahkan produk baru (`name`, `price`, `stock`, `category_id`, `image_url`, `description`, `is_active`). |
| `PUT` | `/api/admin/products/:id` | Admin | Memperbarui data/stok produk secara dinamis. |
| `DELETE` | `/api/admin/products/:id` | Admin | Menghapus produk. Menggunakan **Soft Delete** jika produk sudah pernah dibeli, atau **Hard Delete** jika belum pernah dibeli. |

### 🏷️ 5. Katalog Kategori (Publik) — `/api/categories`
| Method | Endpoint | Akses | Deskripsi |
| :---: | :--- | :---: | :--- |
| `GET` | `/api/categories` | Publik | Mengambil semua kategori beserta kalkulasi jumlah produk aktif terkait (`product_count`). Mendukung pencarian `?search=...`. |
| `GET` | `/api/categories/slug/:slug` | Publik | Mengambil detail kategori berdasarkan slug URL-friendly. |
| `GET` | `/api/categories/:id` | Publik | Mengambil detail kategori berdasarkan ID numerik. |

### 🛠️ 6. Manajemen Kategori (Admin) — `/api/admin/categories`
| Method | Endpoint | Akses | Deskripsi |
| :---: | :--- | :---: | :--- |
| `GET` | `/api/admin/categories` | Admin | Mengambil daftar seluruh kategori untuk admin. |
| `GET` | `/api/admin/categories/:id` | Admin | Mengambil detail kategori berdasarkan ID. |
| `POST` | `/api/admin/categories` | Admin | Membuat kategori baru (auto slug generator & validasi duplikasi). |
| `PUT` | `/api/admin/categories/:id` | Admin | Memperbarui nama, slug, atau icon kategori. |
| `DELETE` | `/api/admin/categories/:id` | Admin | Menghapus kategori. Menghitung dan mengabari jumlah produk terkait yang diset ke tanpa kategori. |

### 🛒 7. Keranjang Belanja — `/api/cart`
| Method | Endpoint | Akses | Deskripsi |
| :---: | :--- | :---: | :--- |
| `GET` | `/api/cart` | User | Mengambil isi keranjang belanja user, detail produk aktif, subtotal, dan `grand_total`. |
| `POST` | `/api/cart` | User | Menambahkan produk ke keranjang (otomatis *upsert* kuantitas jika produk sudah ada). |
| `PUT` | `/api/cart/:id` | User | Memperbarui kuantitas produk dalam keranjang (validasi status aktif dan sisa stok). |
| `DELETE` | `/api/cart/:id` | User | Menghapus satu item dari keranjang belanja. |
| `DELETE` | `/api/cart` | User | Mengosongkan seluruh keranjang belanja user. |

### 📋 8. Pesanan Pengguna — `/api/orders`
| Method | Endpoint | Akses | Deskripsi |
| :---: | :--- | :---: | :--- |
| `POST` | `/api/orders/checkout` | User | Melakukan checkout pesanan dari keranjang belanja (transaksi database ACID, *row locking*, potong stok produk, dan kosongkan keranjang). |
| `GET` | `/api/orders/:id` | User | Mengambil detail pesanan dalam format JSON terstruktur lengkap beserta daftar item dan informasi pembeli. |
| `POST` | `/api/orders/:orderId/pay` | User | Mengunggah file bukti transfer (`multipart/form-data`, field: `proof_image`). File disimpan ke Supabase Storage dan status diubah ke `PROCESSING`. |

### 📊 9. Manajemen Pesanan & Dashboard (Admin) — `/api/admin/orders`
| Method | Endpoint | Akses | Deskripsi |
| :---: | :--- | :---: | :--- |
| `GET` | `/api/admin/orders/summary` | Admin | Mengambil ringkasan statistik pesanan (total pesanan, total omset dari status valid, dan perincian order per status). |
| `GET` | `/api/admin/orders` | Admin | Mengambil daftar pesanan dengan filter status, pencarian (order ID / email user), pagination, dan signed URL bukti transfer. |
| `GET` | `/api/admin/orders/:orderId` | Admin | Mengambil detail lengkap pesanan spesifik, data customer, item produk, dan signed URL bukti transfer. |
| `PATCH` | `/api/admin/orders/:orderId/status` | Admin | Mengubah status pesanan (misal: `PAID`, `CANCELLED`). Mengembalikan stok produk otomatis jika dibatalkan, atau memotong stok kembali jika pesanan batal diaktifkan kembali. |

### 💳 10. Webhook Payment Gateway — `/api/orders/webhook/payment`
| Method | Endpoint | Akses | Deskripsi |
| :---: | :--- | :---: | :--- |
| `POST` | `/api/orders/webhook/payment` | Webhook | Menerima callback notifikasi status pembayaran dari Payment Gateway. Request divalidasi dengan signature HMAC SHA-512. |

---

## 💻 Cara Menjalankan

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Environment Variables
Buat file `.env` di root project dengan referensi variabel berikut:

```env
PORT=3000
NODE_ENV=development

# Database PostgreSQL Lokal
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=ecommerce_db

# Atau gunakan Database URL (opsional, jika menggunakan Supabase / Cloud Database)
# DATABASE_URL=postgres://postgres:password@db.xxxx.supabase.co:5432/postgres

# JWT & Security (Customer Portal)
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d

# JWT & Security (Admin Portal)
ADMIN_JWT_SECRET=your_admin_jwt_secret_key
ADMIN_JWT_EXPIRES_IN=8h

# Payment Gateway
PAYMENT_SERVER_KEY=your_payment_server_key

# Supabase Storage Configuration (Bukti Transfer)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

> **Catatan:** Jangan commit file `.env` ke repository publik. Pastikan `.env` terdaftar di `.gitignore`.

### 3. Migrasi Database
Jalankan migrasi tabel database PostgreSQL:
```bash
# Menjalankan seluruh migrasi yang belum dieksekusi
npm run migrate:up

# Membatalkan migrasi terakhir
npm run migrate:down
```

### 4. Jalankan Server
* **Mode Development (dengan Nodemon auto-reload):**
  ```bash
  npm run dev
  ```
* **Mode Production:**
  ```bash
  npm start
  ```

---

## 📌 Fitur Unggulan Sistem
1. 🔐 **Autentikasi & RBAC**: Akses stateless berbasis JWT dengan pemisahan hak akses jelas antara *User* dan *Admin*.
2. ⚡ **Row-Level Locking & ACID Checkout**: Mencegah *race condition* dan *overselling* stok pada pembelian dengan konkurensi tinggi.
3. 🛡️ **Penghapusan Produk Pintar (Smart Delete)**: Melindungi integritas data transaksi lampau dengan otomatis melakukan *soft delete* (`is_active = false`) jika produk pernah dibeli.
4. 🔄 **Sinkronisasi Stok Otomatis**: Pengembalian stok otomatis jika pesanan dibatalkan/ditolak admin, dan pemotongan kembali secara aman jika status dibalikkan.
5. ☁️ **Supabase Private Storage**: Penyimpanan bukti transfer pada private bucket dengan pengamanan *Signed URL* berbatas waktu 60 menit.
6. 🔎 **GIN Trigram Indexing**: Pencarian produk berbasis teks yang sangat cepat memanfaatkan ekstensi PostgreSQL `pg_trgm`.
