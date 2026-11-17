# OpenAPI & Swagger UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyediakan kontrak OpenAPI yang tervalidasi, Swagger UI non-produksi, dan contoh penggunaan tanpa menambah dependency produksi.

**Architecture:** `docs/openapi.yaml` menjadi sumber kebenaran. Router docs lazy-load `yaml` + `swagger-ui-express` dan hanya dipasang saat `NODE_ENV !== "production"`. Tes Node memvalidasi spec dan menyamakan daftar operasi dengan router Express; CI menjalankan validator yang sama.

**Tech Stack:** Node 24, Express 5, CommonJS, OpenAPI 3.0.3, `swagger-ui-express@^5.0.1`, `yaml@^2.9.1`, `@apidevtools/swagger-parser@^13.1.0`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-16-openapi-swagger-design.md`

## Global Constraints

- Jangan commit atas nama user. Setiap task berakhir dengan wording commit; user yang menjalankan `git commit`.
- `swagger-ui-express`, `yaml`, dan `@apidevtools/swagger-parser` hanya `devDependencies`.
- Swagger UI dan route docs hanya aktif saat `NODE_ENV !== "production"`.
- Tidak mengubah endpoint, validasi, status code, response, skema DB, atau format angka yang sudah ada.
- `numeric(12)` scale 0 tetap final; harga/total di JSON tetap `number`.
- Contoh di spec memakai placeholder; tidak boleh ada JWT nyata, service key, atau data pelanggan.
- ID `bigint` dari PostgreSQL dikirim sebagai JSON `string`; ID `serial`/`integer` sebagai `number`. Contoh: user/product/order `id` string, category `id` number, cart item `id` number.
- Semua verifikasi akhir: `npm test`, `npm run test:db`, `npm run test:coverage`, `npm run lint`, `npm run docs:validate`, `npm audit --omit=dev`, `git diff --check`.

## Review Focus

- `NODE_ENV=production` tidak boleh menyajikan `/api/docs` walau devDependencies terpasang. Test: unit gating di Task 1.
- Route Express yang ditambah/dihapus tanpa update spec harus menggagalkan CI. Test: exact-set sync di Task 4.
- Swagger UI harus tetap berfungsi di bawah `helmet`; CSP route docs boleh `'unsafe-inline'`, CSP global tidak boleh ikut longgar. Test: header docs + `/health` di Task 1.
- YAML/`$ref` yang tidak valid harus gagal validasi, bukan baru ketahuan saat dibuka manual. Test: parser validation di Task 2.
- Dokumentasi auth/error harus sesuai perilaku nyata: login gagal generik `401`, admin/user token salah `403`, upload invalid `400`, webhook signature salah `403`. Test: security/error matrix di Task 4.

---

### Task 1: Runtime Swagger UI dan gating non-production

**Files:**
- Create: `src/docs/apiDocs.js`
- Create: `docs/openapi.yaml` (spec minimal; dilengkapi di Task 2–4)
- Create: `tests/docs/apiDocs.test.js`
- Existing: `docs/superpowers/specs/2026-11-16-openapi-swagger-design.md`, `docs/superpowers/plans/2026-11-16-openapi-swagger.md` (sertakan dalam commit)
- Modify: `src/app.js` (mount sebelum `notFound`)
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: tidak ada.
- Produces:
  - `isApiDocsEnabled({ nodeEnv = process.env.NODE_ENV } = {}) -> boolean`
  - `createApiDocsRouter() -> import("express").Router`
  - `SPEC_PATH: string` (absolute path ke `docs/openapi.yaml`)

- [ ] **Step 1: Install dependency dev**

```bash
npm install --save-dev swagger-ui-express@^5.0.1 yaml@^2.9.1
```

Expected: `package.json` memuat ketiga paket di `devDependencies`; `npm audit --omit=dev` tidak berubah.

- [ ] **Step 2: Tulis tes yang gagal**

Buat `tests/docs/apiDocs.test.js`:

```js
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { startTestServer, request, db } = require("../helpers/api");
const { isApiDocsEnabled } = require("../../src/docs/apiDocs");

let closeServer;
let baseUrl;

before(async () => {
  const server = await startTestServer();
  baseUrl = server.baseUrl;
  closeServer = server.close;
});

after(async () => {
  if (closeServer) await closeServer();
  await db.pool.end();
});

test("docs hanya non-production", () => {
  assert.equal(isApiDocsEnabled({ nodeEnv: "production" }), false);
  assert.equal(isApiDocsEnabled({ nodeEnv: "development" }), true);
  assert.equal(isApiDocsEnabled({ nodeEnv: "test" }), true);
  assert.equal(isApiDocsEnabled({ nodeEnv: undefined }), true);
});

test("GET /api/docs/ menyajikan Swagger UI", async () => {
  const response = await request(baseUrl, "/api/docs/");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(response.body, /id="swagger-ui"/);
  assert.match(response.body, /swagger-ui-bundle\.js/);
});

test("GET /api/docs/openapi.json menyajikan spec", async () => {
  const response = await request(baseUrl, "/api/docs/openapi.json");

  assert.equal(response.status, 200);
  assert.equal(response.body.openapi, "3.0.3");
  assert.equal(typeof response.body.paths, "object");
});

test("GET /api/docs/openapi.yaml menyajikan sumber YAML", async () => {
  const response = await request(baseUrl, "/api/docs/openapi.yaml");

  assert.equal(response.status, 200);
  assert.match(response.body, /openapi: 3\.0\.3/);
});

test("CSP docs mengizinkan inline script tanpa duplikasi policy", async () => {
  const response = await request(baseUrl, "/api/docs/");
  const csp = response.headers.get("content-security-policy") || "";

  assert.match(csp, /script-src[^;]*'unsafe-inline'/);
  assert.equal((csp.match(/script-src/g) || []).length, 1);
});

test("CSP global tetap tidak mengizinkan inline script", async () => {
  const response = await request(baseUrl, "/health");
  const csp = response.headers.get("content-security-policy") || "";

  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
});
```

- [ ] **Step 3: Jalankan tes dan pastikan gagal**

```bash
node --require ./tests/setup.js --test tests/docs/apiDocs.test.js
```

Expected: FAIL dengan `Cannot find module '../../src/docs/apiDocs'`.

- [ ] **Step 4: Buat spec minimal**

Buat `docs/openapi.yaml`:

```yaml
openapi: 3.0.3
info:
  title: FastShop API
  version: 1.0.0
  description: Kontrak API FastShop.
servers:
  - url: http://localhost:3001
paths: {}
```

- [ ] **Step 5: Implementasikan `src/docs/apiDocs.js`**

Perilaku yang harus dipenuhi:
- `SPEC_PATH = path.resolve(__dirname, "../../docs/openapi.yaml")`.
- `isApiDocsEnabled` hanya `false` untuk string `"production"`; nilai lain/undefined `true`.
- `createApiDocsRouter` melakukan lazy `require("yaml")` dan `require("swagger-ui-express")`, membaca `SPEC_PATH` sekali, lalu membuat `express.Router()`.
- Middleware pertama docs router wajib `res.removeHeader("Content-Security-Policy")` untuk membuang policy global Helmet; beberapa header CSP digabung oleh browser, bukan saling menimpa.
- Setelah itu pasang CSP khusus sebelum route: `defaultSrc ["'self'"]`, `scriptSrc ["'self'", "'unsafe-inline'"]`, `styleSrc ["'self'", "'unsafe-inline'"]`, `imgSrc ["'self'", "data:"]`, `fontSrc ["'self'", "data:"]`, `connectSrc ["'self'"]`, `useDefaults: false`.
- `GET /openapi.yaml` mengirim teks YAML; `GET /openapi.json` mengirim objek hasil parse.
- `router.use("/", swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: "FastShop API Docs", swaggerOptions: { persistAuthorization: true, displayRequestDuration: true, filter: true } }))`.

- [ ] **Step 6: Mount di `src/app.js`**

Tambahkan import dan pasang tepat setelah `app.use("/api", mainRoutes);`, sebelum `notFound`:

```js
const { isApiDocsEnabled, createApiDocsRouter } = require("./docs/apiDocs");

if (isApiDocsEnabled()) {
  app.use("/api/docs", createApiDocsRouter());
}
```

- [ ] **Step 7: Jalankan tes dan pastikan lulus**

```bash
node --require ./tests/setup.js --test tests/docs/apiDocs.test.js
```

Expected: 6/6 PASS.

- [ ] **Step 8: Wording commit**

```
feat(docs): serve Swagger UI outside production

- Add lazy-loaded API docs router with strict NODE_ENV gating
- Serve Swagger UI, parsed JSON, and raw YAML at /api/docs
- Add docs-specific CSP without loosening global Helmet policy
- Add gating, route, and CSP tests
```

---

### Task 2: Spec foundation, auth, dan katalog publik

**Files:**
- Modify: `docs/openapi.yaml`
- Create: `tests/docs/openapi.test.js`
- Create: `scripts/validate-openapi.js`
- Modify: `package.json`, `package-lock.json`
- Modify: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: `SPEC_PATH` dari Task 1.
- Produces: `npm run docs:validate` (exit 0 jika spec valid); 13 operasi pertama di spec.

- [ ] **Step 1: Install validator dev**

```bash
npm install --save-dev @apidevtools/swagger-parser@^13.1.0
```

- [ ] **Step 2: Tulis tes yang gagal**

Buat `tests/docs/openapi.test.js` dengan validasi parser dan daftar operasi Task 2:

```js
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const SwaggerParser = require("@apidevtools/swagger-parser");

const SPEC_PATH = path.join(__dirname, "../../docs/openapi.yaml");
const REQUIRED_OPERATIONS = [
  ["get", "/health"],
  ["get", "/200"],
  ["get", "/ready"],
  ["post", "/api/auth/register"],
  ["post", "/api/auth/login"],
  ["get", "/api/auth/me"],
  ["post", "/api/admin/auth/login"],
  ["get", "/api/admin/auth/me"],
  ["get", "/api/products"],
  ["get", "/api/products/{id}"],
  ["get", "/api/categories"],
  ["get", "/api/categories/slug/{slug}"],
  ["get", "/api/categories/{id}"],
];

let api;

before(async () => {
  api = await SwaggerParser.validate(SPEC_PATH);
});

test("spec OpenAPI valid", () => {
  assert.equal(api.openapi, "3.0.3");
  assert.equal(typeof api.info.title, "string");
  assert.ok(api.servers.length > 0);
  assert.ok(api.components.securitySchemes.userBearer);
  assert.ok(api.components.securitySchemes.adminBearer);
});

test("operasi Task 2 terdokumentasi", () => {
  for (const [method, routePath] of REQUIRED_OPERATIONS) {
    assert.ok(api.paths[routePath]?.[method], `${method} ${routePath} hilang`);
  }
});

test("setiap operasi punya metadata dan response", () => {
  const operationIds = new Set();

  for (const [method, routePath] of REQUIRED_OPERATIONS) {
    const operation = api.paths[routePath][method];
    assert.ok(operation.summary, `${method} ${routePath} tanpa summary`);
    assert.ok(Array.isArray(operation.tags) && operation.tags.length > 0);
    assert.ok(operation.operationId);
    assert.equal(operationIds.has(operation.operationId), false);
    operationIds.add(operation.operationId);
    assert.ok(Object.keys(operation.responses).length > 0);
  }
});
```

- [ ] **Step 3: Jalankan tes dan pastikan gagal**

```bash
node --require ./tests/setup.js --test tests/docs/openapi.test.js
```

Expected: FAIL karena `paths` masih kosong.

- [ ] **Step 4: Lengkapi skeleton spec dan komponen**

Tambahkan:
- `components.securitySchemes.userBearer` dan `adminBearer` (HTTP bearer, `bearerFormat: JWT`).
- `components.schemas.ErrorResponse` (`code` integer, `message` string).
- `components.schemas.Pagination` (`currentPage`, `limit`, `totalItems`, `totalPages` integer; `hasPreviousPage`, `hasNextPage` boolean).
- `components.schemas.User` (`id` string bigint, `name`, `email`, `role`, `phone_number` nullable, `created_at` date-time).
- `components.schemas.ProductSummary`: `id` string, `name`, `price` number, `stock` integer, `image_url` nullable, `category_name` nullable. Ini bentuk list publik.
- `components.schemas.ProductDetail`: semua field ProductSummary + `description` nullable + `category_id` integer nullable. Ini bentuk detail publik.
- `components.schemas.AdminProductSummary`: seperti ProductSummary + `is_active` boolean — bentuk list admin.
- `components.schemas.AdminProductDetail`: seperti ProductDetail + `is_active` boolean — bentuk detail admin.
- `components.schemas.Category` (`id` integer, `name`, `slug`, `icon_url` nullable, `created_at`, `product_count` integer).
- Response create/update product memakai row `RETURNING *` (tanpa `category_name`); jangan memakai schema detail. Response create/update category juga row mentah tanpa `product_count`.
- Response pembungkus sesuai endpoint; jangan memakai schema generik yang mengubah bentuk `data`.

- [ ] **Step 5: Tulis 13 operasi Task 2**

| Method | Path | Auth | Sukses | Error wajib |
| --- | --- | --- | --- | --- |
| GET | `/health` | publik | 200 `{status:"ok"}` | 500 |
| GET | `/200` | publik | 200 `{status:"ok"}` | 500 |
| GET | `/ready` | publik | 200 `{status:"ready"}` | 503 |
| POST | `/api/auth/register` | publik | 201 user | 400, 409, 429, 500 |
| POST | `/api/auth/login` | publik | 200 `{user, token}` | 400, 401, 429, 500 |
| GET | `/api/auth/me` | userBearer | 200 user | 401, 403, 404, 500 |
| POST | `/api/admin/auth/login` | publik | 200 `{admin, token}` | 400, 401, 429, 500 |
| GET | `/api/admin/auth/me` | adminBearer | 200 user admin | 401, 403, 404, 500 |
| GET | `/api/products` | publik | 200 daftar + pagination | 400, 500 |
| GET | `/api/products/{id}` | publik | 200 produk | 400, 404, 500 |
| GET | `/api/categories` | publik | 200 daftar kategori | 400, 500 |
| GET | `/api/categories/slug/{slug}` | publik | 200 kategori | 400, 404, 500 |
| GET | `/api/categories/{id}` | publik | 200 kategori | 400, 404, 500 |

Detail yang harus tertulis:
- Register: `name` 1–100, `email` valid maks 150, `password` 8–72 byte dan mengandung huruf + angka.
- Login: pesan gagal generik; token user default `1d`, token admin default `8h`.
- Query produk: `category_id` integer positif, `search` maks 100, `page` default 1, `limit` default 10 maks 100.
- Query kategori: `search` maks 100.
- Contoh respons memakai ID string untuk user/product dan number untuk category.
- Semua operasi diberi `operationId` unik dan tag yang sesuai.

- [ ] **Step 6: Buat `scripts/validate-openapi.js` dan script npm**

Isi script: resolve `docs/openapi.yaml`, jalankan `SwaggerParser.validate`, cetak `OpenAPI valid: <path>` saat sukses, dan set `process.exitCode = 1` saat gagal. Tambahkan `"docs:validate": "node scripts/validate-openapi.js"` ke `package.json`.

- [ ] **Step 7: Tambahkan langkah CI**

Di `.github/workflows/test.yml`, setelah `npm ci`, tambahkan:

```yaml
      - name: Validate OpenAPI
        run: npm run docs:validate
```

- [ ] **Step 8: Jalankan validasi dan tes**

```bash
npm run docs:validate
node --require ./tests/setup.js --test tests/docs/openapi.test.js
```

Expected: validator mencetak `OpenAPI valid`; 3/3 PASS.

- [ ] **Step 9: Wording commit**

```
docs(api): add OpenAPI foundation and public endpoints

- Add OpenAPI 3.0.3 skeleton, security schemes, and shared schemas
- Document system, auth, admin auth, product, and category endpoints
- Add Swagger Parser validation script and CI step
- Add spec validation and metadata tests
```

---

### Task 3: Spec keranjang, pesanan, upload, dan webhook

**Files:**
- Modify: `docs/openapi.yaml`
- Modify: `tests/docs/openapi.test.js`

**Interfaces:**
- Consumes: komponen dari Task 2.
- Produces: 23 operasi total (13 + 10).

- [ ] **Step 1: Tambahkan operasi baru ke `REQUIRED_OPERATIONS`**

Tambahkan 10 baris:

```js
["get", "/api/cart"],
["post", "/api/cart"],
["put", "/api/cart/{id}"],
["delete", "/api/cart/{id}"],
["delete", "/api/cart"],
["post", "/api/orders/checkout"],
["get", "/api/orders"],
["get", "/api/orders/{id}"],
["post", "/api/orders/{orderId}/pay"],
["post", "/api/orders/webhook/payment"],
```

- [ ] **Step 2: Jalankan tes dan pastikan gagal**

```bash
node --require ./tests/setup.js --test tests/docs/openapi.test.js
```

Expected: FAIL karena operasi baru belum ada.

- [ ] **Step 3: Tambahkan schema**

- `CartItem`: `cart_item_id` number, `product_id` string, `product_name`, `price` number, `image_url` nullable, `quantity` number, `stock` number, `is_active` boolean, `is_available` boolean, `subtotal` number.
- `CartResponse`: `{ items: CartItem[], grand_total: number }`.
- `AddCartRequest`: `product_id` integer positif, `quantity` integer positif.
- `UpdateCartRequest`: `quantity` integer positif.
- `OrderItem`: `order_item_id` string, `product_id` string, `product_name`, `product_image` nullable, `quantity` number, `price_at_purchase` number, `subtotal` number.
- `OrderSummary`: `order_id` string, `user_id` string, `total_amount` number, `status` enum, `shipping_address`, `payment_proof_url` nullable string, `payment_submitted_at` nullable date-time, `created_at`, `updated_at`, `total_items` number, `total_quantity` number, `items` OrderItem[].
- `OrderDetail`: `id` string, `user_id` string, field order lain, `items` OrderItem[].
- `OrderStatus`: enum 7 nilai.
- `CheckoutRequest`: `shipping_address` 1–1000.
- `UploadProofRequest`: `multipart/form-data`, `proof_image` binary wajib, JPEG/PNG/WebP maks 2MB, magic bytes diverifikasi.
- `WebhookRequest`: `order_id` string/number, `status_code` string/number wajib untuk signature, `transaction_status` string, `gross_amount` string/number, `signature_key` string SHA-512.

- [ ] **Step 4: Tulis 10 operasi Task 3**

| Method | Path | Auth | Sukses | Error wajib |
| --- | --- | --- | --- | --- |
| GET | `/api/cart` | userBearer | 200 CartResponse | 401, 403, 500 |
| POST | `/api/cart` | userBearer | 200 row cart item | 400, 401, 403, 404, 500 |
| PUT | `/api/cart/{id}` | userBearer | 200 row cart item | 400, 401, 403, 404, 500 |
| DELETE | `/api/cart/{id}` | userBearer | 200 `{id}` | 400, 401, 403, 404, 500 |
| DELETE | `/api/cart` | userBearer | 200 `{deleted_count}` | 401, 403, 500 |
| POST | `/api/orders/checkout` | userBearer | 201 order | 400, 401, 403, 500 |
| GET | `/api/orders` | userBearer | 200 daftar + pagination | 400, 401, 403, 500 |
| GET | `/api/orders/{id}` | userBearer | 200 OrderDetail | 400, 401, 403, 404, 500 |
| POST | `/api/orders/{orderId}/pay` | userBearer | 200 order PROCESSING | 400, 401, 403, 404, 429, 500 |
| POST | `/api/orders/webhook/payment` | signature | 200 order + `previous_status`/`already_processed` | 400, 403, 429, 500 |

Detail yang harus tertulis:
- Item cart nonaktif tetap tampil dengan `is_available: false`; `grand_total` hanya menjumlah item tersedia.
- `POST /api/cart` dan `PUT /api/cart/{id}` mengembalikan row `cart_items` mentah (`id`, `user_id`, `product_id`, `quantity`, `created_at`, `updated_at`), bukan `CartItem`.
- Checkout menolak cart kosong, produk nonaktif, dan stok kurang.
- Upload hanya untuk order `PENDING` milik user; setelah sukses status `PROCESSING`; `payment_proof_url` pada respons upload adalah path file, bukan signed URL.
- Webhook memakai hash SHA-512 (bukan HMAC) dari `order_id + status_code + gross_amount + PAYMENT_SERVER_KEY`; `signature_key` salah `403`; status idempotent.
- `payment_proof_url` di list/detail user dan admin adalah signed URL; di webhook/upload berupa path.
- Contoh `order_id`/`id` string, `total_amount`/`subtotal` number.

- [ ] **Step 5: Jalankan validasi dan tes**

```bash
npm run docs:validate
node --require ./tests/setup.js --test tests/docs/openapi.test.js
```

Expected: 3/3 PASS dengan 23 operasi.

- [ ] **Step 6: Wording commit**

```
docs(api): document cart, orders, upload, and webhook

- Add cart, checkout, order history, payment proof, and webhook operations
- Add cart/order upload request and response schemas
- Document signed URL, stock, multipart, and SHA-512 signature behavior
- Extend OpenAPI coverage tests
```

---

### Task 4: Spec admin lengkap dan tes sinkronisasi route

**Files:**
- Modify: `docs/openapi.yaml`
- Modify: `tests/docs/openapi.test.js`

**Interfaces:**
- Consumes: komponen dan 23 operasi dari Task 2–3.
- Produces: 38 operasi total; exact-set sync test terhadap router Express.

- [ ] **Step 1: Tambahkan 15 operasi admin ke `REQUIRED_OPERATIONS`**

```js
["get", "/api/admin/products"],
["get", "/api/admin/products/{id}"],
["post", "/api/admin/products"],
["put", "/api/admin/products/{id}"],
["delete", "/api/admin/products/{id}"],
["get", "/api/admin/categories"],
["get", "/api/admin/categories/{id}"],
["post", "/api/admin/categories"],
["put", "/api/admin/categories/{id}"],
["delete", "/api/admin/categories/{id}"],
["get", "/api/admin/orders/summary"],
["get", "/api/admin/orders"],
["get", "/api/admin/orders/{orderId}"],
["patch", "/api/admin/orders/{orderId}/status"],
["get", "/api/admin/audit-logs"],
```

- [ ] **Step 2: Tambahkan schema admin**

- `AdminProduct`: semua field Product + `is_active`, `category_id`, `created_at`, `updated_at`.
- `CreateProductRequest`: wajib `name` 1–100, `price` number 0–999999999999, `stock` integer 0–2147483647; opsional `description` maks 5000, `category_id` integer/null, `image_url` maks 2048/null, `is_active` boolean.
- `UpdateProductRequest`: semua field opsional.
- `CreateCategoryRequest`: `name` 1–100 wajib; `slug` maks 100 opsional; `icon_url` maks 2048/null opsional.
- `UpdateCategoryRequest`: semua opsional.
- `AdminOrderSummary`: `order_id` string, `user_id` string, `email`, `user_name`, `total_amount` number, `status`, `shipping_address`, `payment_proof_url` nullable, `payment_submitted_at`, `created_at`, `updated_at`.
- `AdminOrderDetail`: `id` string, `user_id`, `email`, `user_name`, `phone_number` nullable, field order lain, `items` OrderItem[].
- `OrderStats`: `totalOrders` number, `totalRevenue` number, `ordersByStatus` object dengan 7 status.
- `StatusUpdateRequest`: `status` OrderStatus.
- `AuditLog`: `id` string, `actor_id` string/null, `actor_email` string/null, `action`, `entity_type`, `entity_id` string, `before_data` object/null, `after_data` object/null, `ip_address` string/null, `created_at`.

- [ ] **Step 3: Tulis 15 operasi admin**

| Method | Path | Auth | Sukses | Error wajib |
| --- | --- | --- | --- | --- |
| GET | `/api/admin/products` | adminBearer | 200 daftar + pagination | 400, 401, 403, 500 |
| GET | `/api/admin/products/{id}` | adminBearer | 200 produk admin | 400, 401, 403, 404, 500 |
| POST | `/api/admin/products` | adminBearer | 201 produk admin | 400, 401, 403, 500 |
| PUT | `/api/admin/products/{id}` | adminBearer | 200 produk admin | 400, 401, 403, 404, 500 |
| DELETE | `/api/admin/products/{id}` | adminBearer | 200 `{id, delete_type}` | 400, 401, 403, 404, 500 |
| GET | `/api/admin/categories` | adminBearer | 200 daftar kategori | 400, 401, 403, 500 |
| GET | `/api/admin/categories/{id}` | adminBearer | 200 kategori | 400, 401, 403, 404, 500 |
| POST | `/api/admin/categories` | adminBearer | 201 kategori | 400, 401, 403, 409, 500 |
| PUT | `/api/admin/categories/{id}` | adminBearer | 200 kategori | 400, 401, 403, 404, 409, 500 |
| DELETE | `/api/admin/categories/{id}` | adminBearer | 200 `{category, affected_products_count}` | 400, 401, 403, 404, 500 |
| GET | `/api/admin/orders/summary` | adminBearer | 200 OrderStats | 401, 403, 500 |
| GET | `/api/admin/orders` | adminBearer | 200 daftar + pagination | 400, 401, 403, 500 |
| GET | `/api/admin/orders/{orderId}` | adminBearer | 200 AdminOrderDetail | 400, 401, 403, 404, 500 |
| PATCH | `/api/admin/orders/{orderId}/status` | adminBearer | 200 order | 400, 401, 403, 404, 500 |
| GET | `/api/admin/audit-logs` | adminBearer | 200 AuditLog[] + pagination | 400, 401, 403, 500 |

Detail yang harus tertulis:
- Product delete: `delete_type` `soft_deleted` atau `hard_deleted`.
- Category delete: `affected_products_count`, produk terkait menjadi `category_id: null`.
- Admin order list: `search` maks 150; signed URL bukti transfer.
- Status update: transisi valid `PENDING→PROCESSING/PAID/CANCELLED/FAILED`, `PROCESSING→PAID/CANCELLED/FAILED`, `PAID→SHIPPED`, `SHIPPED→COMPLETED`, `CANCELLED/FAILED→PAID`; transisi lain `400`.
- Audit log filter: `entity_type` maks 50, `action` maks 100, `actor_id` integer positif, pagination.
- Aksi audit yang tercatat: `product.create/update/delete`, `category.create/update/delete`, `order.status.update`.

- [ ] **Step 4: Tambahkan exact-set sync test**

Tambahkan helper di `tests/docs/openapi.test.js`:

```js
const authRoutes = require("../../src/routes/authRoutes");
const orderRoutes = require("../../src/routes/orderRoutes");
const cartRoutes = require("../../src/routes/cartRoutes");
const paymentRoutes = require("../../src/routes/paymentRoutes");
const productRoutes = require("../../src/routes/productRoutes");
const categoryRoutes = require("../../src/routes/categoryRoutes");
const adminProductRoutes = require("../../src/routes/adminProductRoutes");
const adminCategoryRoutes = require("../../src/routes/adminCategoryRoutes");
const adminAuditLogRoutes = require("../../src/routes/adminAuditLogRoutes");
const adminAuthRoutes = require("../../src/routes/adminAuthRoutes");

const ROUTER_MOUNTS = [
  [authRoutes, "/api/auth"],
  [orderRoutes, "/api/orders"],
  [cartRoutes, "/api/cart"],
  [paymentRoutes, "/api"],
  [productRoutes, "/api/products"],
  [categoryRoutes, "/api/categories"],
  [adminProductRoutes, "/api/admin"],
  [adminCategoryRoutes, "/api/admin"],
  [adminAuditLogRoutes, "/api/admin"],
  [adminAuthRoutes, "/api/admin/auth"],
];

const toOpenApiPath = (prefix, routePath) => {
  const full = `${prefix}${routePath}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  return full.length > 1 && full.endsWith("/") ? full.slice(0, -1) : full;
};

const collectRouterOperations = () => {
  const operations = new Set([["get", "/health"], ["get", "/200"], ["get", "/ready"]]
    .map(([method, routePath]) => `${method.toUpperCase()} ${routePath}`));

  for (const [router, prefix] of ROUTER_MOUNTS) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        operations.add(
          `${method.toUpperCase()} ${toOpenApiPath(prefix, layer.route.path)}`,
        );
      }
    }
  }

  return operations;
};
```

Tes baru:

```js
test("operasi spec sama persis dengan route Express", () => {
  const specOperations = new Set();

  for (const [routePath, pathItem] of Object.entries(api.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      if (pathItem[method]) {
        specOperations.add(`${method.toUpperCase()} ${routePath}`);
      }
    }
  }

  assert.deepEqual([...specOperations].sort(), [...collectRouterOperations()].sort());
});
```

- [ ] **Step 5: Tambahkan tes matriks auth/error dan contoh aman**

Tambahkan:
- Operasi dengan `security` wajib punya response `401` dan `403`.
- Operasi `/api/admin/*` (kecuali `/api/admin/auth/login`) memakai `adminBearer`.
- Operasi user (`/api/auth/me`, `/api/cart*`, `/api/orders*` kecuali webhook) memakai `userBearer`.
- Webhook tidak memakai security scheme dan mendokumentasikan `403`.
- Assertion eksplisit: `POST /api/auth/login` punya `401`; `POST /api/orders/{orderId}/pay` punya `400`; `POST /api/orders/webhook/payment` punya `403`.
- Isi YAML tidak mengandung pola JWT `eyJ[A-Za-z0-9_-]{20,}` atau string `service_role`.

- [ ] **Step 6: Jalankan validasi dan tes**

```bash
npm run docs:validate
node --require ./tests/setup.js --test tests/docs/openapi.test.js
```

Expected: validator sukses; seluruh tes PASS; exact-set 38 operasi.

- [ ] **Step 7: Wording commit**

```
docs(api): document admin endpoints and guard route drift

- Add admin product, category, order, and audit log operations
- Add admin request/response schemas and status transition rules
- Compare Express router operations against the OpenAPI spec exactly
- Assert auth/error matrices and reject JWT-like examples
```

---

### Task 5: README, dokumentasi proyek, dan verifikasi akhir

**Files:**
- Modify: `README.md`
- Modify: `docs/to-do/todo-perbaikan.md`
- Modify: `docs/analisa/analisis-project.md`
- Modify: `.superpowers/sdd/todo-perbaikan/progress.md` (gitignored, jangan dimasukkan commit)

**Interfaces:**
- Consumes: semua route/spec dari Task 1–4.
- Produces: dokumentasi penggunaan dan status task P2-03.

- [ ] **Step 1: Tambahkan bagian README**

Tambahkan setelah tabel endpoint (sebelum bagian “Cara Menjalankan”) bagian `## 📘 Dokumentasi API (OpenAPI)` yang memuat:
- Sumber: `docs/openapi.yaml`.
- Swagger UI: `http://localhost:3001/api/docs` hanya saat `NODE_ENV !== "production"`.
- JSON: `/api/docs/openapi.json`; YAML: `/api/docs/openapi.yaml`.
- Validasi: `npm run docs:validate`; CI juga menjalankannya.
- Contoh `curl` login user, katalog, dan request ber-token.
- Catatan admin memakai `/api/admin/auth/login` dan token admin terpisah.

- [ ] **Step 2: Selaraskan dokumentasi auth README**

Ganti klaim bahwa login pelanggan/admin gagal dengan `403` menjadi perilaku nyata:
- Login pelanggan dengan akun admin atau kredensial salah → `401` dengan pesan generik.
- Login admin dengan akun non-admin atau kredensial salah → `401` dengan pesan generik.
- `403` tetap dipakai saat token valid tetapi role/type tidak sesuai pada endpoint terproteksi.

- [ ] **Step 3: Perbarui tree README**

Tambahkan `docs/openapi.yaml`, `docs/superpowers/`, `src/docs/apiDocs.js`, `scripts/validate-openapi.js`, dan `tests/docs/` pada struktur direktori.

- [ ] **Step 4: Update checklist P2-03**

Di `docs/to-do/todo-perbaikan.md`, ubah P2-03 menjadi selesai dengan:
- Progres tanggal 16 November 2026.
- Daftar file baru/berubah.
- Checklist `[x]` untuk keempat item.
- Definition of Done dan hasil verifikasi aktual.

- [ ] **Step 5: Update analisis**

Di `docs/analisa/analisis-project.md`, tandai item OpenAPI/Swagger selesai dan catat bahwa spec divalidasi di CI serta UI hanya non-production.

- [ ] **Step 6: Tambahkan catatan ledger**

Tambahkan ringkasan task, ruling (manual YAML, devDependencies, gating strict), dan hasil verifikasi ke `.superpowers/sdd/todo-perbaikan/progress.md`. File ini gitignored; jangan dimasukkan commit.

- [ ] **Step 7: Jalankan verifikasi lengkap**

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
- `npm test`: semua non-DB test lulus, termasuk `tests/docs`.
- `npm run test:db`: seluruh suite lulus.
- coverage memenuhi ambang 60%.
- lint OK untuk semua file JS, termasuk `scripts/validate-openapi.js` dan `tests/docs`.
- validator mencetak `OpenAPI valid`.
- audit produksi 0 vulnerabilities.
- diff check bersih.

- [ ] **Step 8: Wording commit**

```
docs: add OpenAPI usage guide and close P2-03

- Document Swagger UI access, spec locations, and curl examples
- Align README auth failure behavior with generic 401 responses
- Mark P2-03 complete and record verification results
- Update project analysis and local ledger
```

---

## Self-Review

- **Spec coverage:** Setiap bagian desain punya task: runtime + gating (Task 1), spec/validator/CI (Task 2), user commerce (Task 3), admin + sync (Task 4), README/checklist/verifikasi (Task 5).
- **Step scan:** Setiap step menghasilkan satu aksi yang bisa dicek; test ditulis sebelum implementasi; tidak ada langkah “TBD”.
- **Type consistency:** Nama `isApiDocsEnabled`, `createApiDocsRouter`, `SPEC_PATH`, `docs:validate`, dan `REQUIRED_OPERATIONS` konsisten antar-task.
- **Review Focus:** Production exposure (Task 1), drift (Task 4), CSP (Task 1), invalid spec (Task 2), auth/error mismatch (Task 4) semuanya punya tes.
- **Proportion:** Plan memuat keputusan dan matriks operasi; isi YAML detail diserahkan ke implementer.
