# P2-07 Code Cleanup dan Konsistensi — Design

**Tanggal:** 18 November 2026

**Status:** Menunggu persetujuan

**Sumber:** `docs/to-do/todo-perbaikan.md`, item P2-07.

## 1. Intent

Membereskan dead code, duplikasi, noise `dotenv`, dan `.gitignore` yang minim tanpa mengubah kontrak API. Fokusnya konsistensi internal: satu sumber perilaku untuk pagination, satu implementasi untuk daftar/detail produk publik vs admin, dan satu implementasi untuk handler baca kategori publik vs admin.

## 2. Goals

- Menghapus middleware `verifyAuthToken` dan `authorize` yang tidak dipakai.
- Menyatukan sanitasi dan metadata pagination ke satu helper.
- Menghilangkan duplikasi daftar/detail produk publik vs admin.
- Menghilangkan duplikasi handler baca kategori publik vs admin.
- Menghilangkan output `dotenv` yang tidak perlu pada entrypoint script/test.
- Menghapus referensi `SUPABASE_PUBLISHABLE_KEY` yang tidak dipakai kode runtime dari setup test dan CI.
- Melengkapi `.gitignore` untuk artefak lokal.
- Menjaga seluruh route, status code, pesan respons, dan bentuk JSON tetap sama.

## 3. Non-goals

- Tidak mengubah kontrak OpenAPI atau menambah/menghapus operasi.
- Tidak mengubah skema database atau menambah migrasi.
- Tidak menambah dependency produksi maupun dev baru, termasuk formatter baru.
- Tidak menyentuh `.env`; perubahan environment lokal dibicarakan terpisah.
- Tidak menyatukan route publik dan admin menjadi satu file.
- Tidak mengubah perilaku pagination yang sudah divalidasi Zod di route.

## 4. Constraints

- P2-06 sudah di-commit sebagai `df160cf` pada branch `develop`; P2-07 dimulai dari worktree bersih di atas commit tersebut.
- Ekspor fungsi service dan controller yang dipakai route harus tetap ada dengan nama yang sama.
- `npm test`, `npm run test:db`, `npm run test:coverage`, `npm run lint`, `npm run docs:validate`, dan `npm audit --omit=dev` harus tetap hijau.
- Target coverage tidak boleh turun di bawah ambang 60% lines/branches/functions.

## 5. Kondisi Saat Ini

- `src/middlewares/authMiddleware.js` mendefinisikan dan mengekspor `verifyAuthToken` serta `authorize`, tetapi tidak ada route, test, atau script yang memakainya.
- `src/services/productService.js` memiliki `getProducts` vs `getProductsAdmin` dan `getProductById` vs `getProductByIdAdmin` yang hampir identik; perbedaannya hanya filter `p.is_active` dan kolom `p.is_active` pada hasil admin.
- `src/controllers/productController.js` dan `src/controllers/adminProductController.js` menduplikasi handler list/detail dengan pesan yang sama.
- `src/controllers/categoryController.js` dan `src/controllers/adminCategoryController.js` menduplikasi handler list/detail; hanya pesan daftar admin yang berbeda.
- Sanitasi `page`/`limit` dan metadata pagination disalin di `productService`, `orderService`, `paymentService`, dan `auditLogService`.
- `scripts/prepare-test-db.js` dan `tests/setup.js` memanggil `dotenv.config()` tanpa `{ quiet: true }`; file lain sudah memakai opsi tersebut.
- `SUPABASE_PUBLISHABLE_KEY` hanya muncul di `tests/setup.js` dan `.github/workflows/test.yml`; `src/config/supabase.js` memakai `SUPABASE_SERVICE_ROLE_KEY`.
- `.gitignore` hanya berisi `/.env` dan `/node_modules`.
- Import `require("../routes/authRoutes")` yang disebut checklist P2-07 sudah tidak ada di `productService.js`.

## 6. Pendekatan

### A. Refactor internal dengan kontrak modul tetap — dipilih

Tambahkan helper pagination, satukan core produk di dalam service yang sama, dan buat factory handler baca bersama. Route, nama ekspor, dan bentuk respons tidak berubah.

- Trade-off: diff sedang dan ada lapisan abstraksi baru, tetapi risiko regresi rendah karena perilaku publik tetap dijaga oleh wrapper dan test integrasi yang sudah ada.

### B. Konsolidasi modul penuh — ditolak

Gabungkan controller publik/admin menjadi satu modul berbasis mode dan satukan service produk/kategori menjadi satu modul. Duplikasi paling banyak hilang, tetapi perubahan struktural besar, alur lebih sulit ditelusuri, dan risiko pesan/response berubah lebih tinggi.

Pemilik project memilih **A**.

## 7. Desain Rinci

### 7.1 Hapus dead code autentikasi

File: `src/middlewares/authMiddleware.js`

- Hapus fungsi `verifyAuthToken`.
- Hapus fungsi `authorize`.
- Hapus keduanya dari `module.exports`.
- `verifyUserToken`, `verifyAdminToken`, dan `isTokenVersionValid` tidak berubah.
- Tidak ada route/test yang perlu diubah karena tidak ada pemakai.

### 7.2 Helper pagination

File baru: `src/utils/pagination.js`

```js
parsePagination({ page = 1, limit = 10, maxLimit = 100 })
// -> { page: number, limit: number, offset: number }

buildPagination({ page, limit, totalItems })
// -> { currentPage, limit, totalItems, totalPages, hasPreviousPage, hasNextPage }
```

Perilaku `parsePagination` harus menyalin formula saat ini:

- `page = Math.max(1, Number.parseInt(page, 10) || 1)`
- `rawLimit = Number.parseInt(limit, 10) || 10`
- `limit = Math.min(maxLimit, Math.max(1, rawLimit))`
- `offset = (page - 1) * limit`

Perilaku `buildPagination`:

- `totalPages = Math.ceil(totalItems / limit) || 1`
- `hasPreviousPage = page > 1`
- `hasNextPage = page < totalPages`

Pemakai:

- `src/services/productService.js` — dua fungsi daftar yang nanti disatukan.
- `src/services/orderService.js` — `getUserOrders`.
- `src/services/paymentService.js` — `getAllOrdersForAdmin`.
- `src/services/auditLogService.js` — `listAuditLogs`.

Nilai `totalItems` tetap dinormalisasi di masing-masing service seperti sekarang (`parseInt`, guard `?.count`, atau `parseInt` biasa) sebelum masuk `buildPagination`.

### 7.3 Core produk tunggal

File: `src/services/productService.js`

Fungsi internal baru (tidak diekspor):

```js
listProducts({ categoryId, search, page, limit, activeOnly })
getProductByIdWithOptions(id, { activeOnly })
```

Perilaku:

- `activeOnly: true` → tambahkan kondisi `p.is_active = TRUE` dan jangan pilih kolom `p.is_active`.
- `activeOnly: false` → tanpa filter aktif dan pilih kolom `p.is_active`.
- Kolom, urutan kolom, `ORDER BY p.id DESC`, filter kategori, dan pencarian `ILIKE` dipertahankan persis.
- Sanitasi pagination memakai `parsePagination`; metadata memakai `buildPagination`.

Wrapper yang tetap diekspor:

- `getProducts` → `listProducts({ ...args, activeOnly: true })`
- `getProductsAdmin` → `listProducts({ ...args, activeOnly: false })`
- `getProductById` → `getProductByIdWithOptions(id, { activeOnly: true })`
- `getProductByIdAdmin` → `getProductByIdWithOptions(id, { activeOnly: false })`

### 7.4 Factory handler baca produk

File baru: `src/controllers/productReadHandlers.js`

```js
createProductReadHandlers({ listProducts, getProductById })
// -> { getProductList, getProductDetail }
```

- `getProductList` mempertahankan parsing query, pemanggilan service, status `200`, pesan `"Berhasil mengambil daftar produk"`, `data`, dan `pagination`.
- `getProductDetail` mempertahankan validasi `isNaN(id)`, status `400`/`404`, dan pesan yang ada.
- `src/controllers/productController.js` menjadi instance publik yang memakai `productService.getProducts` dan `productService.getProductById`.
- `src/controllers/adminProductController.js` memakai instance admin untuk list/detail, lalu tetap memiliki `createProduct`, `updateProduct`, dan `deleteProduct` beserta audit log.

### 7.5 Factory handler baca kategori

File baru: `src/controllers/categoryReadHandlers.js`

```js
createCategoryReadHandlers({ getAllCategories, getCategoryById, listMessage })
// -> { getCategoryList, getCategoryDetail }
```

- Detail kategori mempertahankan validasi `isNaN(id)`, status `400`/`404`, dan pesan `"Berhasil mengambil detail kategori"` / `"Kategori tidak ditemukan"`.
- `src/controllers/categoryController.js` memakai `listMessage: "Berhasil mengambil daftar kategori"` dan tetap memiliki `getCategoryBySlug`.
- `src/controllers/adminCategoryController.js` memakai `listMessage: "Berhasil mengambil daftar kategori admin"` dan tetap memiliki `createCategory`, `updateCategory`, dan `deleteCategory` beserta audit log.

### 7.6 `dotenv` dan `SUPABASE_PUBLISHABLE_KEY`

- `scripts/prepare-test-db.js`: ubah menjadi `require("dotenv").config({ quiet: true })`.
- `tests/setup.js`: ubah menjadi `require("dotenv").config({ quiet: true })`.
- Hapus baris `process.env.SUPABASE_PUBLISHABLE_KEY ||= "test-publishable-key";` dari `tests/setup.js`.
- Hapus `SUPABASE_PUBLISHABLE_KEY: ci-publishable-key` dari `.github/workflows/test.yml`.
- `.env` dan `.env.example` tidak diubah. Jika pemilik project ingin menghapus `SUPABASE_PUBLISHABLE_KEY` dari `.env` lokal, itu dilakukan terpisah dengan persetujuan.

### 7.7 `.gitignore`

Tambahkan:

```gitignore
.DS_Store
*.log
/coverage/
/.superpowers/
```

Baris lama `/.env` dan `/node_modules` dipertahankan.

### 7.8 Lint dan format

Tidak menambah Prettier atau dependency baru. Konsistensi diverifikasi dengan `npm run lint` yang sudah ada, ditambah `git diff --check`.

## 8. Strategi Test (TDD)

1. **Helper pagination** — tulis `tests/utils/pagination.test.js` lebih dulu:
   - default page/limit/offset,
   - input string, `0`, negatif, `NaN`, dan limit di atas 100,
   - `totalItems = 0` menghasilkan `totalPages = 1`,
   - `hasPreviousPage`/`hasNextPage` pada halaman tengah dan terakhir.
2. **Factory handler baca** — tulis `tests/controllers/catalogReadHandlers.test.js`:
   - service palsu untuk memastikan fungsi yang benar dipanggil,
   - status/pesan/`data`/`pagination` diteruskan,
   - pesan daftar kategori publik vs admin berbeda sesuai parameter,
   - error service diteruskan ke `next`.
3. **Karakterisasi produk** — tambah assertion di `tests/api/catalog.test.js`:
   - detail produk publik tidak memuat `is_active`,
   - detail produk admin memuat `is_active`,
   - daftar admin tetap memuat produk nonaktif, daftar publik tidak (bila belum tercakup test Smart Delete yang ada).
4. **Regresi** — seluruh test lama harus tetap lulus; tidak ada test yang dihapus atau dilonggarkan.

## 9. Risiko dan Mitigasi

| Risiko | Mitigasi |
| :--- | :--- |
| Query produk berubah sehingga field/response bergeser | Assertion karakterisasi publik vs admin; wrapper mempertahankan nama dan bentuk respons |
| Perilaku pagination tepi berubah | Unit test helper menyalin formula lama; test service/API lama tetap dijalankan |
| Factory controller mengubah pesan/status | Unit test handler dengan service palsu; test API yang ada tetap dijalankan |
| Dead code ternyata dipakai secara dinamis | Pencarian referensi di `src`, `tests`, `scripts`, dan `docs`; hasilnya nol pemakai |
| `.env` tidak sengaja berubah | Tidak ada edit `.env` dalam scope; perubahan environment dibicarakan terpisah |

## 10. Definition of Done

- [ ] `verifyAuthToken` dan `authorize` terhapus beserta ekspornya.
- [ ] `parsePagination`/`buildPagination` dipakai di empat service dan punya unit test.
- [ ] Daftar/detail produk publik dan admin memakai core yang sama tanpa perubahan JSON.
- [ ] Handler baca kategori publik dan admin memakai factory yang sama tanpa perubahan pesan.
- [ ] `dotenv` di `prepare-test-db.js` dan `tests/setup.js` memakai `{ quiet: true }`.
- [ ] `SUPABASE_PUBLISHABLE_KEY` tidak lagi disetel di test setup dan CI.
- [ ] `.gitignore` memuat `.DS_Store`, `*.log`, `/coverage/`, dan `/.superpowers/`.
- [ ] `npm test`, `npm run test:db`, `npm run test:coverage`, `npm run lint`, `npm run docs:validate`, `npm audit --omit=dev`, dan `git diff --check` hijau.
- [ ] Dokumentasi struktur dan progres P2-07 diperbarui.

## 11. Rollback

Semua perubahan bersifat kode dan test; tidak ada migrasi database atau perubahan dependency. Rollback cukup mengembalikan file yang diubah/ditambah. Tidak ada data production yang terpengaruh.
