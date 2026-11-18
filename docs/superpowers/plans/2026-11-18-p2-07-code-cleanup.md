# P2-07 Code Cleanup dan Konsistensi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghapus dead code, menyatukan pagination dan duplikasi handler/service produk-kategori, serta merapikan `dotenv`, environment test/CI, dan `.gitignore` tanpa mengubah kontrak API.

**Architecture:** Helper pagination baru menjadi satu sumber formula sanitasi dan metadata. `productService` memakai core internal dengan opsi `activeOnly` yang dibungkus fungsi ekspor lama, sementara controller produk/kategori memakai factory handler baca bersama. Route, nama ekspor, status code, pesan, dan bentuk JSON tidak berubah.

**Tech Stack:** Node.js 24, CommonJS, Express 5, PostgreSQL, `node:test`, tanpa dependency baru.

**Spec:** `docs/superpowers/specs/2026-11-18-p2-07-code-cleanup-design.md`

## Global Constraints

- Jangan commit, tag, atau push. Pemilik project meng-commit sendiri; plan ini hanya menyiapkan wording commit di akhir.
- Tidak ada dependency baru, termasuk formatter. Verifikasi format memakai `npm run lint` dan `git diff --check`.
- Kontrak API tidak berubah: route, status code, pesan respons, dan bentuk JSON harus sama persis.
- `.env` tidak boleh dibuat, diubah, atau di-commit. Perubahan environment lokal dibicarakan terpisah.
- TDD untuk kode baru: test harus terlihat gagal sebelum implementasi, lalu hijau.
- Refactor memakai test karakterisasi yang sudah ada; jalankan baseline sebelum mengubah kode dan ulangi setelahnya.
- Test unit dijalankan dengan `node --test <path>`; test database dengan `npm run test:db`.
- `npm test` harus tetap 0 fail; test DB yang butuh PostgreSQL dijalankan lewat script proyek.
- Jangan mengubah `verifyUserToken`, `verifyAdminToken`, atau `isTokenVersionValid` saat menghapus dead code.
- Baseline P2-06: commit `df160cf` pada branch `develop`.

## Review Focus

1. **Pagination tepi:** `page`/`limit` berupa `0`, negatif, `NaN`, string, atau di atas 100 harus menghasilkan `{ page, limit, offset }` dan metadata yang sama seperti formula lama; test di Task 1.
2. **Produk nonaktif:** endpoint publik harus menyembunyikan produk `is_active = false` dan tidak memuat field `is_active`; endpoint admin harus menampilkannya beserta `is_active`; test di Task 2.
3. **Pesan kategori publik vs admin:** daftar admin harus tetap `"Berhasil mengambil daftar kategori admin"`, daftar publik `"Berhasil mengambil daftar kategori"`; test di Task 5.
4. **Error service:** kegagalan service pada handler list/detail harus diteruskan ke `next(error)`, bukan ditelan atau diubah menjadi 500 inline; test di Task 4 dan Task 5.
5. **Konfigurasi lokal:** `.DS_Store`, log, coverage, dan `.superpowers/` harus benar-benar diabaikan Git, dan entrypoint test tidak lagi mencetak pesan `dotenv`; test di Task 7.

---

### Task 1: Helper pagination

**Files:**
- Create: `src/utils/pagination.js`
- Test: `tests/utils/pagination.test.js`

**Interfaces:**
- Produces: `parsePagination({ page = 1, limit = 10, maxLimit = 100 }) -> { page: number, limit: number, offset: number }`
- Produces: `buildPagination({ page, limit, totalItems }) -> { currentPage, limit, totalItems, totalPages, hasPreviousPage, hasNextPage }`

- [ ] **Step 1: Tulis test yang gagal**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePagination,
  buildPagination,
} = require("../../src/utils/pagination");

test("parsePagination memakai default page 1 limit 10 offset 0", () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 10, offset: 0 });
});

test("parsePagination menerima string angka", () => {
  assert.deepEqual(parsePagination({ page: "3", limit: "20" }), {
    page: 3,
    limit: 20,
    offset: 40,
  });
});

test("parsePagination menjepit page dan limit seperti perilaku lama", () => {
  assert.deepEqual(parsePagination({ page: "0", limit: "0" }), {
    page: 1,
    limit: 10,
    offset: 0,
  });
  assert.deepEqual(parsePagination({ page: "-2", limit: "-5" }), {
    page: 1,
    limit: 1,
    offset: 0,
  });
  assert.deepEqual(parsePagination({ page: "abc", limit: "abc" }), {
    page: 1,
    limit: 10,
    offset: 0,
  });
  assert.deepEqual(parsePagination({ page: "1", limit: "101" }), {
    page: 1,
    limit: 100,
    offset: 0,
  });
});

test("buildPagination total kosong tetap satu halaman", () => {
  assert.deepEqual(
    buildPagination({ page: 1, limit: 10, totalItems: 0 }),
    {
      currentPage: 1,
      limit: 10,
      totalItems: 0,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    },
  );
});

test("buildPagination menghitung halaman tengah dan akhir", () => {
  assert.deepEqual(
    buildPagination({ page: 2, limit: 10, totalItems: 25 }),
    {
      currentPage: 2,
      limit: 10,
      totalItems: 25,
      totalPages: 3,
      hasPreviousPage: true,
      hasNextPage: true,
    },
  );
  assert.deepEqual(
    buildPagination({ page: 3, limit: 10, totalItems: 25 }),
    {
      currentPage: 3,
      limit: 10,
      totalItems: 25,
      totalPages: 3,
      hasPreviousPage: true,
      hasNextPage: false,
    },
  );
});
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `node --test tests/utils/pagination.test.js`
Expected: FAIL karena `src/utils/pagination.js` belum ada.

- [ ] **Step 3: Implementasi helper**

Buat `src/utils/pagination.js` dengan formula yang menyalin perilaku lama:

```js
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_LIMIT = 100;

const parsePagination = ({
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
  maxLimit = DEFAULT_MAX_LIMIT,
} = {}) => {
  const pageNum = Math.max(1, Number.parseInt(page, 10) || DEFAULT_PAGE);
  const rawLimit = Number.parseInt(limit, 10) || DEFAULT_LIMIT;
  const limitNum = Math.min(maxLimit, Math.max(1, rawLimit));

  return {
    page: pageNum,
    limit: limitNum,
    offset: (pageNum - 1) * limitNum,
  };
};

const buildPagination = ({ page, limit, totalItems }) => {
  const totalPages = Math.ceil(totalItems / limit) || 1;

  return {
    currentPage: page,
    limit,
    totalItems,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
};

module.exports = {
  parsePagination,
  buildPagination,
};
```

- [ ] **Step 4: Jalankan test dan pastikan lulus**

Run: `node --test tests/utils/pagination.test.js`
Expected: semua test PASS.

- [ ] **Step 5: Verifikasi lint**

Run: `npm run lint`
Expected: `Lint OK`.

---

### Task 2: Core produk tunggal dan test karakterisasi

**Files:**
- Modify: `src/services/productService.js:4-210`
- Modify: `tests/api/catalog.test.js` (tambahkan test di akhir)

**Interfaces:**
- Consumes: `parsePagination`, `buildPagination` dari `src/utils/pagination.js`.
- Produces (internal, tidak diekspor): `listProducts({ categoryId, search, page, limit, activeOnly }) -> { products, pagination }`.
- Produces (internal, tidak diekspor): `getProductByIdWithOptions(id, { activeOnly }) -> object | null`.
- Mempertahankan ekspor: `getProducts`, `getProductById`, `getProductsAdmin`, `getProductByIdAdmin`, `createProduct`, `updateProduct`, `deleteProduct`.

- [ ] **Step 1: Tulis test karakterisasi yang gagal jika perilaku berubah**

Tambahkan di akhir `tests/api/catalog.test.js`:

```js
dbTest("produk nonaktif hanya terlihat di endpoint admin", async () => {
  const suffix = uniqueSuffix();
  const created = await request(baseUrl, "/api/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Produk Nonaktif ${suffix}`,
      price: 4000,
      stock: 2,
    },
  });
  assert.equal(created.status, 201);

  const productId = created.body.data.id;
  productIds.push(productId);

  await db.query("UPDATE products SET is_active = FALSE WHERE id = $1", [
    productId,
  ]);

  const publicList = await request(
    baseUrl,
    `/api/products?search=${encodeURIComponent(created.body.data.name)}`,
  );
  assert.equal(publicList.status, 200);
  assert.equal(
    publicList.body.data.some((item) => item.id === productId),
    false,
  );

  const publicDetail = await request(baseUrl, `/api/products/${productId}`);
  assert.equal(publicDetail.status, 404);

  const adminList = await request(
    baseUrl,
    `/api/admin/products?search=${encodeURIComponent(created.body.data.name)}`,
    { token: adminToken },
  );
  assert.equal(adminList.status, 200);
  const adminItem = adminList.body.data.find((item) => item.id === productId);
  assert.ok(adminItem);
  assert.equal(adminItem.is_active, false);

  const adminDetail = await request(
    baseUrl,
    `/api/admin/products/${productId}`,
    { token: adminToken },
  );
  assert.equal(adminDetail.status, 200);
  assert.equal(adminDetail.body.data.is_active, false);

  const publicActiveDetail = await request(
    baseUrl,
    `/api/products/${product.id}`,
  );
  assert.equal(publicActiveDetail.status, 200);
  assert.equal(
    Object.hasOwn(publicActiveDetail.body.data, "is_active"),
    false,
  );
});
```

- [ ] **Step 2: Jalankan test karakterisasi pada kode lama**

Run: `npm run test:db -- --test-name-pattern "produk nonaktif"`
Expected: PASS. Test ini mengunci perilaku sebelum refactor.

- [ ] **Step 3: Refactor `productService`**

Di `src/services/productService.js`:

- Impor `parsePagination` dan `buildPagination`.
- Buat `listProducts({ categoryId, search, page = 1, limit = 10, activeOnly })`:
  - `const conditions = activeOnly ? ["p.is_active = TRUE"] : [];`
  - Kolom select: `p.id, p.name, p.price, p.stock`, lalu `p.is_active` hanya jika `activeOnly === false`, lalu `p.image_url, c.name AS category_name`.
  - Filter kategori dan pencarian tetap memakai placeholder yang sama.
  - Sanitasi memakai `parsePagination`.
  - Metadata memakai `buildPagination`.
- Buat `getProductByIdWithOptions(id, { activeOnly })`:
  - `WHERE p.id = $1` ditambah `AND p.is_active = TRUE` hanya jika `activeOnly`.
  - Kolom `p.is_active` hanya dipilih jika `activeOnly === false`.
- Ganti isi wrapper:
  - `getProducts` memanggil `listProducts({ ...args, activeOnly: true })`.
  - `getProductsAdmin` memanggil `listProducts({ ...args, activeOnly: false })`.
  - `getProductById` memanggil `getProductByIdWithOptions(id, { activeOnly: true })`.
  - `getProductByIdAdmin` memanggil `getProductByIdWithOptions(id, { activeOnly: false })`.
- Jangan mengubah `createProduct`, `updateProduct`, `deleteProduct`, atau `module.exports`.

- [ ] **Step 4: Jalankan test karakterisasi dan suite DB**

Run: `npm run test:db -- --test-name-pattern "produk nonaktif"`
Expected: PASS.
Run: `npm run test:db`
Expected: seluruh test PASS.

- [ ] **Step 5: Verifikasi lint**

Run: `npm run lint`
Expected: `Lint OK`.

---

### Task 3: Pakai helper pagination di order, payment, dan audit log

**Files:**
- Modify: `src/services/orderService.js:116`
- Modify: `src/services/paymentService.js:191`
- Modify: `src/services/auditLogService.js:59`

**Interfaces:**
- Consumes: `parsePagination`, `buildPagination` dari Task 1.
- Mempertahankan bentuk respons: `{ ..., pagination: { currentPage, limit, totalItems, totalPages, hasPreviousPage, hasNextPage } }`.

- [ ] **Step 1: Jalankan baseline test DB**

Run: `npm run test:db`
Expected: seluruh test PASS sebelum refactor.

- [ ] **Step 2: Refactor `orderService.getUserOrders`**

Ganti blok sanitasi manual dengan:

```js
const {
  page: pageNum,
  limit: limitNum,
  offset,
} = parsePagination({ page, limit });
```

Pertahankan normalisasi `totalItems` yang ada (`countResult.rows[0]?.count ? parseInt(...) : 0`), lalu ganti objek metadata dengan:

```js
pagination: buildPagination({
  page: pageNum,
  limit: limitNum,
  totalItems,
}),
```

- [ ] **Step 3: Refactor `paymentService.getAllOrdersForAdmin` dan `auditLogService.listAuditLogs`**

Lakukan pola yang sama: ganti sanitasi manual dengan `parsePagination`, pertahankan normalisasi `totalItems`, dan ganti objek metadata dengan `buildPagination`. Jangan mengubah query, filter, atau urutan hasil.

- [ ] **Step 4: Jalankan suite DB dan lint**

Run: `npm run test:db`
Expected: seluruh test PASS.
Run: `npm run lint`
Expected: `Lint OK`.

---

### Task 4: Factory handler baca produk

**Files:**
- Create: `src/controllers/productReadHandlers.js`
- Test: `tests/controllers/productReadHandlers.test.js`
- Modify: `src/controllers/productController.js`
- Modify: `src/controllers/adminProductController.js:1-56`

**Interfaces:**
- Produces: `createProductReadHandlers({ listProducts, getProductById }) -> { getProductList, getProductDetail }`.
- `getProductList(req, res, next)` memanggil `listProducts({ categoryId: req.query.category_id, search: req.query.search, page: parseInt(req.query.page), limit: parseInt(req.query.limit) })`.
- `getProductDetail(req, res, next)` memvalidasi `isNaN(req.params.id)` sebelum memanggil service.

- [ ] **Step 1: Tulis test yang gagal**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createProductReadHandlers,
} = require("../../src/controllers/productReadHandlers");

const createRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

test("getProductList meneruskan query dan pagination", async () => {
  const calls = [];
  const handlers = createProductReadHandlers({
    listProducts: async (args) => {
      calls.push(args);
      return {
        products: [{ id: 1 }],
        pagination: { currentPage: 2, limit: 5 },
      };
    },
    getProductById: async () => null,
  });

  const req = {
    query: { category_id: "3", search: "kopi", page: "2", limit: "5" },
  };
  const res = createRes();
  let nextError;

  await handlers.getProductList(req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
  assert.deepEqual(calls[0], {
    categoryId: "3",
    search: "kopi",
    page: 2,
    limit: 5,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    code: 200,
    message: "Berhasil mengambil daftar produk",
    data: [{ id: 1 }],
    pagination: { currentPage: 2, limit: 5 },
  });
});

test("getProductDetail menolak ID tidak valid tanpa memanggil service", async () => {
  let called = false;
  const handlers = createProductReadHandlers({
    listProducts: async () => null,
    getProductById: async () => {
      called = true;
      return null;
    },
  });

  const res = createRes();
  let nextError;

  await handlers.getProductDetail(
    { params: { id: "abc" } },
    res,
    (error) => {
      nextError = error;
    },
  );

  assert.equal(called, false);
  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "ID produk tidak valid");
});

test("getProductDetail mengembalikan 404 dan 200", async () => {
  const missingHandlers = createProductReadHandlers({
    listProducts: async () => null,
    getProductById: async () => null,
  });
  const missingRes = createRes();
  await missingHandlers.getProductDetail(
    { params: { id: "99" } },
    missingRes,
    () => {},
  );
  assert.equal(missingRes.statusCode, 404);
  assert.equal(missingRes.body.message, "Produk tidak ditemukan");

  const foundHandlers = createProductReadHandlers({
    listProducts: async () => null,
    getProductById: async () => ({ id: 99, name: "Produk" }),
  });
  const foundRes = createRes();
  await foundHandlers.getProductDetail(
    { params: { id: "99" } },
    foundRes,
    () => {},
  );
  assert.equal(foundRes.statusCode, 200);
  assert.deepEqual(foundRes.body, {
    code: 200,
    message: "Berhasil mengambil detail produk",
    data: { id: 99, name: "Produk" },
  });
});

test("error service diteruskan ke next", async () => {
  const failure = new Error("db down");
  const handlers = createProductReadHandlers({
    listProducts: async () => {
      throw failure;
    },
    getProductById: async () => null,
  });

  let received;
  await handlers.getProductList({ query: {} }, createRes(), (error) => {
    received = error;
  });

  assert.equal(received, failure);
});
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `node --test tests/controllers/productReadHandlers.test.js`
Expected: FAIL karena modul `productReadHandlers` belum ada.

- [ ] **Step 3: Implementasi factory**

Buat `src/controllers/productReadHandlers.js`. Pindahkan logika handler dari kedua controller tanpa mengubah parsing query, status code, pesan, atau `next(error)`.

- [ ] **Step 4: Pasang factory di kedua controller**

`src/controllers/productController.js` menjadi:

```js
const productService = require("../services/productService");
const {
  createProductReadHandlers,
} = require("./productReadHandlers");

const { getProductList, getProductDetail } = createProductReadHandlers({
  listProducts: productService.getProducts,
  getProductById: productService.getProductById,
});

module.exports = {
  getProductList,
  getProductDetail,
};
```

`src/controllers/adminProductController.js` memakai factory yang sama dengan `productService.getProductsAdmin` dan `productService.getProductByIdAdmin`, lalu mempertahankan `createProduct`, `updateProduct`, `deleteProduct`, audit log, dan `module.exports`.

- [ ] **Step 5: Jalankan test, suite non-DB, dan lint**

Run: `node --test tests/controllers/productReadHandlers.test.js`
Expected: PASS.
Run: `npm test`
Expected: 0 fail.
Run: `npm run lint`
Expected: `Lint OK`.

---

### Task 5: Factory handler baca kategori

**Files:**
- Create: `src/controllers/categoryReadHandlers.js`
- Test: `tests/controllers/categoryReadHandlers.test.js`
- Modify: `src/controllers/categoryController.js`
- Modify: `src/controllers/adminCategoryController.js:1-48`

**Interfaces:**
- Produces: `createCategoryReadHandlers({ getAllCategories, getCategoryById, listMessage }) -> { getCategoryList, getCategoryDetail }`.
- Detail selalu memakai pesan `"Berhasil mengambil detail kategori"` dan `"Kategori tidak ditemukan"`.

- [ ] **Step 1: Tulis test yang gagal**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createCategoryReadHandlers,
} = require("../../src/controllers/categoryReadHandlers");

const createRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

const createHandlers = (overrides = {}) =>
  createCategoryReadHandlers({
    getAllCategories: async () => [{ id: 1 }],
    getCategoryById: async () => ({ id: 1 }),
    listMessage: "Berhasil mengambil daftar kategori",
    ...overrides,
  });

test("getCategoryList memakai listMessage yang diberikan", async () => {
  const publicRes = createRes();
  await createHandlers().getCategoryList(
    { query: {} },
    publicRes,
    () => {},
  );
  assert.equal(publicRes.body.message, "Berhasil mengambil daftar kategori");

  const adminRes = createRes();
  await createHandlers({
    listMessage: "Berhasil mengambil daftar kategori admin",
  }).getCategoryList({ query: {} }, adminRes, () => {});
  assert.equal(
    adminRes.body.message,
    "Berhasil mengambil daftar kategori admin",
  );
});

test("getCategoryDetail mempertahankan 400, 404, dan 200", async () => {
  const invalidRes = createRes();
  await createHandlers().getCategoryDetail(
    { params: { id: "abc" } },
    invalidRes,
    () => {},
  );
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.message, "ID kategori tidak valid");

  const missingRes = createRes();
  await createHandlers({
    getCategoryById: async () => null,
  }).getCategoryDetail({ params: { id: "99" } }, missingRes, () => {});
  assert.equal(missingRes.statusCode, 404);
  assert.equal(missingRes.body.message, "Kategori tidak ditemukan");

  const foundRes = createRes();
  await createHandlers().getCategoryDetail(
    { params: { id: "1" } },
    foundRes,
    () => {},
  );
  assert.equal(foundRes.statusCode, 200);
  assert.equal(foundRes.body.message, "Berhasil mengambil detail kategori");
});

test("error service diteruskan ke next", async () => {
  const failure = new Error("db down");
  let received;
  await createHandlers({
    getAllCategories: async () => {
      throw failure;
    },
  }).getCategoryList({ query: {} }, createRes(), (error) => {
    received = error;
  });
  assert.equal(received, failure);
});
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `node --test tests/controllers/categoryReadHandlers.test.js`
Expected: FAIL karena modul `categoryReadHandlers` belum ada.

- [ ] **Step 3: Implementasi factory dan pasang di controller**

Buat `src/controllers/categoryReadHandlers.js` dengan logika handler baca yang sama seperti controller saat ini.

- [ ] **Step 4: Wiring controller**

`src/controllers/categoryController.js` memakai `listMessage: "Berhasil mengambil daftar kategori"` dan tetap mengekspor `getCategoryBySlug`.

`src/controllers/adminCategoryController.js` memakai `listMessage: "Berhasil mengambil daftar kategori admin"` dan tetap memiliki `createCategory`, `updateCategory`, `deleteCategory`, audit log, serta `module.exports`.

- [ ] **Step 5: Jalankan test, suite DB, dan lint**

Run: `node --test tests/controllers/categoryReadHandlers.test.js`
Expected: PASS.
Run: `npm run test:db`
Expected: seluruh test PASS.
Run: `npm run lint`
Expected: `Lint OK`.

---

### Task 6: Hapus dead code autentikasi

**Files:**
- Modify: `src/middlewares/authMiddleware.js:25-60,163-174,176-181`
- Test: `tests/middlewares/authMiddleware.exports.test.js`

**Interfaces:**
- Ekspor akhir hanya `verifyAdminToken` dan `verifyUserToken`.

- [ ] **Step 1: Tulis test yang gagal**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const authMiddleware = require("../../src/middlewares/authMiddleware");

test("authMiddleware tidak mengekspor dead code", () => {
  assert.deepEqual(Object.keys(authMiddleware).sort(), [
    "verifyAdminToken",
    "verifyUserToken",
  ]);
});
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `node --test tests/middlewares/authMiddleware.exports.test.js`
Expected: FAIL karena `authorize` dan `verifyAuthToken` masih diekspor.

- [ ] **Step 3: Hapus fungsi dan ekspor**

Hapus `verifyAuthToken`, `authorize`, dan entri keduanya di `module.exports`. Jangan mengubah `verifyUserToken`, `verifyAdminToken`, atau `isTokenVersionValid`.

- [ ] **Step 4: Verifikasi tidak ada pemakai**

Run: `grep -rn "verifyAuthToken\|authorize" src tests scripts`
Expected: tidak ada output.

- [ ] **Step 5: Jalankan test dan lint**

Run: `node --test tests/middlewares/authMiddleware.exports.test.js`
Expected: PASS.
Run: `npm test`
Expected: 0 fail.
Run: `npm run lint`
Expected: `Lint OK`.

---

### Task 7: Rapikan `dotenv`, `SUPABASE_PUBLISHABLE_KEY`, dan `.gitignore`

**Files:**
- Modify: `scripts/prepare-test-db.js:1`
- Modify: `tests/setup.js:1-14`
- Modify: `.github/workflows/test.yml:36`
- Modify: `.gitignore`
- Test: `tests/config/cleanup.test.js`

**Interfaces:**
- Tidak ada perubahan API atau runtime behavior; hanya konfigurasi lokal/test.

- [ ] **Step 1: Tulis test yang gagal**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test(".gitignore memuat artefak lokal", () => {
  const patterns = read(".gitignore").split(/\r?\n/);
  for (const pattern of [
    ".DS_Store",
    "*.log",
    "/coverage/",
    "/.superpowers/",
  ]) {
    assert.ok(patterns.includes(pattern), `.gitignore belum memuat ${pattern}`);
  }
});

test("entrypoint test memakai dotenv quiet", () => {
  for (const file of ["scripts/prepare-test-db.js", "tests/setup.js"]) {
    assert.match(
      read(file),
      /require\("dotenv"\)\.config\(\{ quiet: true \}\)/,
      `${file} belum memakai dotenv quiet`,
    );
  }
});

test("SUPABASE_PUBLISHABLE_KEY tidak lagi disetel di setup dan CI", () => {
  assert.doesNotMatch(read("tests/setup.js"), /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(
    read(".github/workflows/test.yml"),
    /SUPABASE_PUBLISHABLE_KEY/,
  );
});
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `node --test tests/config/cleanup.test.js`
Expected: FAIL pada ketiga test.

- [ ] **Step 3: Terapkan perubahan konfigurasi**

- `scripts/prepare-test-db.js`: `require("dotenv").config({ quiet: true });`
- `tests/setup.js`: `require("dotenv").config({ quiet: true });`
- Hapus `process.env.SUPABASE_PUBLISHABLE_KEY ||= "test-publishable-key";` dari `tests/setup.js`.
- Hapus baris `SUPABASE_PUBLISHABLE_KEY: ci-publishable-key` dari `.github/workflows/test.yml`.
- Tambahkan ke `.gitignore`:

```gitignore
.DS_Store
*.log
/coverage/
/.superpowers/
```

- [ ] **Step 4: Jalankan test, prepare DB, dan verifikasi ignore**

Run: `node --test tests/config/cleanup.test.js`
Expected: PASS.
Run: `npm test`
Expected: 0 fail.
Run: `npm run test:db:prepare`
Expected: selesai tanpa banner promosi `dotenv`.
Run: `git check-ignore -v .DS_Store coverage/ app.log .superpowers/sdd/todo-perbaikan/progress.md .env`
Expected: setiap path cocok dengan pola di `.gitignore`.
Run: `npm run lint`
Expected: `Lint OK`.

---

### Task 8: Dokumentasi dan verifikasi akhir

**Files:**
- Modify: `README.md` (struktur proyek)
- Modify: `docs/to-do/todo-perbaikan.md` (bagian P2-07)
- Modify: `docs/analisa/analisis-project.md` (dead code, duplikasi, dotenv)
- Modify: `.superpowers/sdd/todo-perbaikan/progress.md` (gitignored)
- Create/Modify: `.superpowers/sdd/2026-11-18-p2-07-code-cleanup/progress.md` (gitignored)

**Interfaces:**
- Consumes: seluruh hasil Task 1-7.
- Produces: dokumentasi status P2-07 dan wording commit untuk pemilik project.

- [ ] **Step 1: Perbarui struktur proyek di README**

Tambahkan ke pohon `src/`:

- `controllers/categoryReadHandlers.js` — factory handler baca kategori publik/admin.
- `controllers/productReadHandlers.js` — factory handler baca produk publik/admin.
- `utils/pagination.js` — sanitasi dan metadata pagination bersama.

- [ ] **Step 2: Perbarui `docs/to-do/todo-perbaikan.md`**

Ganti checklist P2-07 menjadi checked dan tambahkan bagian **Progres 18 November 2026** yang mencantumkan:

- dead code dihapus,
- helper pagination dan pemakaiannya,
- core produk dan factory handler,
- `dotenv` quiet, penghapusan `SUPABASE_PUBLISHABLE_KEY` dari setup/CI,
- `.gitignore` baru,
- hasil verifikasi aktual.

Catat bahwa import `authRoutes` di `productService.js` sudah tidak ada sebelum P2-07.

- [ ] **Step 3: Perbarui `docs/analisa/analisis-project.md`**

Ubah bullet dead code, duplikasi, dan `dotenv` menjadi status selesai dengan tanggal 18 November 2026. Jangan mengubah item P2-04 yang tetap ditunda.

- [ ] **Step 4: Jalankan verifikasi lengkap**

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

- [ ] **Step 5: Catat hasil aktual dan wording commit**

Perbarui dokumentasi dengan angka coverage dan jumlah test aktual. Siapkan wording commit untuk pemilik project, contoh:

```text
refactor: clean up dead code and deduplicate catalog handlers

- Add shared pagination parsing and metadata helpers
- Unify public/admin product listing and detail queries
- Extract shared product and category read handlers
- Remove unused auth middleware and legacy test env key
- Silence dotenv on test entrypoints and expand gitignore
```

Jangan menjalankan `git commit`.

---

## Catatan Eksekusi

- Setelah Task 1, helper sudah tersedia untuk Task 2 dan 3.
- Task 4 dan 5 saling independen setelah helper/service selesai; bisa dikerjakan berurutan tanpa saling menunggu.
- Jika test karakterisasi Task 2 gagal pada kode lama, hentikan refactor dan periksa apakah perilaku saat ini memang berbeda dari yang diasumsikan.
- Jika `npm run test:db` gagal karena PostgreSQL tidak tersedia, catat sebagai blocker lingkungan, bukan kegagalan kode.
