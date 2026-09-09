# E-Commerce Backend Service

RESTful API backend untuk platform e-commerce berbasis Node.js, Express.js, dan PostgreSQL. Layanan ini mendukung manajemen autentikasi JWT, pengelolaan produk, pembuatan pesanan (checkout), dan verifikasi webhook pembayaran.

---

## 🏗️ Struktur Proyek

Aplikasi ini menggunakan pola **Layered Architecture** (Controller-Service-Route) untuk memisahkan logika aplikasi dengan rapi:

```text
ECOMMERCE-BACKEND/
├── src/
│   ├── config/
│   │   └── db.js                 # Konfigurasi & koneksi database PostgreSQL
│   ├── controllers/
│   │   ├── authController.js     # Menangani request/response autentikasi
│   │   ├── orderController.js    # Menangani checkout & webhook pembayaran
│   │   └── productController.js  # Menangani katalog & data produk
│   ├── middlewares/
│   │   ├── authMiddleware.js     # Verifikasi token JWT untuk protected routes
│   │   └── verifySignature.js    # Verifikasi HMAC SHA-512 signature webhook
│   ├── routes/
│   │   ├── authRoutes.js         # Endpoint autentikasi (/auth)
│   │   ├── orderRoutes.js        # Endpoint transaksi & webhook (/orders)
│   │   └── productRoutes.js      # Endpoint produk (/products)
│   ├── services/
│   │   ├── authService.js        # Logika bisnis auth & hashing bcrypt
│   │   ├── orderService.js       # Logika bisnis checkout & database order
│   │   └── productService.js     # Logika bisnis produk & stok
│   └── app.js                    # Entry point Express server
├── .env                          # Variabel lingkungan/environment
├── .gitignore
├── package-lock.json
└── package.json
```

---

## 🛡️ Aturan Keamanan & Otentikasi

### 1. User Authentication (JWT)
* Otentikasi menggunakan **JSON Web Token (JWT)** secara stateless.
* Durasi default token diset selama **7 hari** melalui `JWT_EXPIRES_IN`.
* Endpoint yang terproteksi menggunakan `authMiddleware.js`.
* JWT dikirim melalui HTTP header:
  ```http
  Authorization: Bearer <your_jwt_token>
  ```
* Password pengguna dienkripsi menggunakan **Bcrypt** di `authService.js`.

### 2. Payment Gateway Webhook Security
* Endpoint webhook pembayaran dipisahkan dari autentikasi JWT pengguna.
* Keamanan webhook diproteksi oleh `verifySignature.js`.
* Request resmi dari Payment Gateway divalidasi menggunakan **HMAC SHA-512**.

---

## 🗄️ Skema Tabel Database (PostgreSQL)

### `users`
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | BIGSERIAL | PRIMARY KEY |
| `name` | VARCHAR(100) | NOT NULL |
| `email` | VARCHAR(150) | UNIQUE, NOT NULL |
| `password` | VARCHAR(255) | NOT NULL |
| `phone_number` | VARCHAR(20) | NULL |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

### `categories`
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | SERIAL | PRIMARY KEY |
| `name` | VARCHAR(100) | NOT NULL |
| `slug` | VARCHAR(100) | UNIQUE NOT NULL |
| `icon_url` | TEXT | NULL |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

### `products`
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | BIGSERIAL | PRIMARY KEY |
| `category_id` | INT | FOREIGN KEY (`categories.id`) |
| `name` | VARCHAR(200) | NOT NULL |
| `description` | TEXT | NULL |
| `price` | DECIMAL(12, 2) | NOT NULL |
| `stock` | INT | NOT NULL, DEFAULT 0 |
| `image_url` | TEXT | NULL |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT TRUE |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

### `orders`
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | BIGSERIAL | PRIMARY KEY |
| `user_id` | INT | FOREIGN KEY (`users.id`) |
| `total_amount` | DECIMAL(12, 2) | NOT NULL, DEFAULT 0 |
| `shipping_address` | TEXT | NOT NULL |
| `status` | VARCHAR(50) | DEFAULT 'PENDING' |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

### `order_items`
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | BIGSERIAL | PRIMARY KEY |
| `order_id` | INT | FOREIGN KEY (`orders.id`) |
| `product_id` | INT | FOREIGN KEY (`products.id`) |
| `quantity` | INT | NOT NULL |
| `price` | DECIMAL(12, 2) | NOT NULL |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

---

## 🚀 Endpoint API Utama

### 🔐 Autentikasi — `/auth`
| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `POST` | `/auth/register` | Mendaftarkan akun baru. |
| `POST` | `/auth/login` | Autentikasi dan mendapatkan JWT token. |

### 📦 Produk — `/products`
| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/products` | Mengambil daftar produk. |
| `GET` | `/products/:id` | Mengambil detail produk. |

### 🛒 Transaksi & Webhook — `/orders`
| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `POST` | `/orders/checkout` | Checkout belanjaan. Membutuhkan JWT Header. |
| `POST` | `/orders/webhook` | Webhook callback dari Payment Gateway. Diproteksi Signature. |

---

## 💻 Cara Menjalankan

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Environment Variables
Buat file `.env` di root project:

```env
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=ecommerce_db

# JWT & Security
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d

# Payment
PAYMENT_SERVER_KEY=your_payment_server_key
```

> **Catatan:** Jangan commit file `.env` ke repository. Tambahkan `.env` ke `.gitignore` untuk menjaga kredensial tetap aman.

### 3. Jalankan Server
* **Mode Development:**
  ```bash
  npm run dev
  ```
* **Mode Production:**
  ```bash
  node src/app.js
  ```

---

## 📌 Ringkasan

Sistem menggunakan beberapa lapisan keamanan:
* 🔐 **JWT** untuk autentikasi pengguna.
* 🔑 **Bcrypt** untuk mengenkripsi password.
* 🛡️ **HMAC SHA-512** untuk memvalidasi webhook Payment Gateway.
* 🗄️ **PostgreSQL** sebagai database utama.
* 🛒 **Endpoint checkout** dilindungi oleh JWT.
* 💳 **Endpoint webhook** menggunakan signature verification terpisah dari autentikasi pengguna.
