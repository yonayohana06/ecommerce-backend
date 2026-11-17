# Refresh Token, Rotasi, dan Revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan refresh token opaque yang dirotasi, logout yang mencabut sesi, dan revocation seluruh token saat password berubah untuk portal user dan admin.

**Architecture:** Access JWT tetap dipakai untuk request biasa dan sekarang membawa klaim `tokenVersion`. Refresh token opaque dikirim lewat cookie `HttpOnly`, disimpan sebagai SHA-256 di tabel `refresh_tokens`, dan dirotasi dalam transaksi dengan deteksi replay per family. `users.token_version` dinaikkan saat password berubah sehingga access token lama langsung ditolak oleh middleware.

**Tech Stack:** Node.js 24, CommonJS, Express 5, PostgreSQL, `node:test`, `jsonwebtoken`, `bcryptjs`, `cookie` (direct dependency baru, sudah transitive via Express).

**Spec:** `docs/superpowers/specs/2026-11-17-refresh-token-revocation-design.md`

## Global Constraints

- Jangan mengubah `numeric(12)` atau perilaku `npm run seed:admin` / `command create:admin` selain revocation yang diminta.
- Bentuk response body login yang sudah ada tidak boleh berubah; refresh token tidak boleh muncul di body.
- Satu-satunya dependency produksi baru: `cookie@^0.7.2`.
- Jangan commit, tag, atau push. Pemilik project meng-commit sendiri. Plan ini hanya menyiapkan wording commit di akhir.
- Jangan menyentuh `verifyAuthToken`/`authorize`; keduanya dead code untuk P2-07.
- `.env` tidak boleh dibuat, diubah, atau di-commit. Hanya `.env.example`.
- TDD: setiap tes harus dilihat gagal sebelum implementasi, lalu hijau setelahnya.
- Test DB membutuhkan container `pg-local` dan dijalankan lewat `npm run test:db`; test non-DB lewat `npm test`.
- Setiap route baru wajib masuk `docs/openapi.yaml`; exact-set test akan gagal jika tidak.
- Tidak ada token mentah, hash, cookie, atau secret di log, test fixture, atau contoh OpenAPI.
- Default produksi cookie: `Secure=true`, `SameSite=None`. Default non-produksi: `Secure=false`, `SameSite=Lax`.

## Review Focus

1. **Browser lintas site:** cookie refresh harus terkirim saat frontend memakai `credentials: "include"`; produksi memakai `SameSite=None; Secure`, localhost memakai `Lax`.
2. **Replay dan rotasi:** memakai token lama setelah rotasi harus mencabut seluruh family; token terbaru ikut ditolak, bukan menghasilkan 500.
3. **Password change dan CLI:** semua refresh token dicabut, `token_version` naik, access token lama 401, login password lama gagal, login password baru berhasil.
4. **Refresh paralel:** dua request dengan token yang sama tidak boleh deadlock atau 500; rotasi strict boleh membuat satu pemenang dan mencabut family.
5. **Input cookie/Origin tidak valid:** cookie hilang, kedaluwarsa, salah portal, atau Origin asing menghasilkan 401/403 yang konsisten; logout tetap idempoten dan cookie dibersihkan.

---

### Task 1: Migrasi `refresh_tokens` dan `users.token_version`

**Files:**
- Create: `migrations/1794920000000_add-refresh-tokens-and-token-version.js`
- Modify: `tests/db/migration.test.js:66-85`
- Modify: `tests/db/schema.test.js` (tambahkan test di akhir)

**Interfaces:**
- Produces: kolom `users.token_version integer NOT NULL DEFAULT 1`.
- Produces: tabel `refresh_tokens` dengan kolom `id`, `user_id`, `token_hash`, `family_id`, `portal`, `token_version`, `expires_at`, `revoked_at`, `replaced_by_id`, `created_at`, serta index `idx_refresh_tokens_user_active`, `idx_refresh_tokens_family`, `idx_refresh_tokens_expires_at`.

- [ ] **Step 1: Tulis ekspektasi migrasi dan skema yang gagal**

Di `tests/db/migration.test.js`, tambahkan `"refresh_tokens"` ke daftar tabel dan ubah jumlah migrasi dari `8` menjadi `9`. Tambahkan query yang memastikan `users.token_version` ada dengan `is_nullable = 'NO'` dan default `1`.

Di `tests/db/schema.test.js`, tambahkan test dengan nama dan assertion berikut:

```js
test("users.token_version NOT NULL dengan default 1", { skip: !runDbTests }, async () => {
  const column = await getColumn("users", "token_version");
  assert.equal(column.is_nullable, "NO");
  assert.match(column.column_default, /1/);
});

test("refresh_tokens.portal hanya menerima user/admin", { skip: !runDbTests }, async () => {
  await expectStatementError(
    `WITH new_user AS (
       INSERT INTO users (name, email, password, role)
       VALUES ('Portal Invalid', $2, 'hash', 'user')
       RETURNING id
     )
     INSERT INTO refresh_tokens
       (user_id, token_hash, family_id, portal, token_version, expires_at)
     SELECT id, $1, '00000000-0000-0000-0000-000000000001'::uuid,
            'superadmin', 1, NOW() + INTERVAL '1 hour'
     FROM new_user`,
    ["a".repeat(64), uniqueEmail("portal-invalid")],
    "23514",
  );
});

test("refresh_tokens.token_hash unik", { skip: !runDbTests }, async () => {
  // buat user; insert hash "c".repeat(64) dengan family uuid literal;
  // insert kedua dengan family uuid berbeda dan hash sama; harapkan 23505
});

test("refresh_tokens.user_id cascade saat user dihapus", { skip: !runDbTests }, async () => {
  // buat user; insert token dengan family uuid literal;
  // hapus user; SELECT COUNT(*) refresh_tokens WHERE user_id = id -> 0
});
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `npm run test:db -- --test-name-pattern "refresh_tokens|token_version|migration"`
Expected: migrasi masih 8, tabel `refresh_tokens` tidak ada, dan kolom `token_version` tidak ditemukan.

- [ ] **Step 3: Buat migrasi**

Isi migrasi:

```js
exports.up = (pgm) => {
  pgm.addColumn("users", {
    token_version: { type: "integer", notNull: true, default: 1 },
  });

  pgm.createTable("refresh_tokens", {
    id: { type: "bigserial", primaryKey: true },
    user_id: {
      type: "bigint",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    token_hash: { type: "varchar(64)", notNull: true, unique: true },
    family_id: { type: "uuid", notNull: true },
    portal: {
      type: "varchar(10)",
      notNull: true,
      check: "portal IN ('user', 'admin')",
    },
    token_version: { type: "integer", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    revoked_at: { type: "timestamptz" },
    replaced_by_id: {
      type: "bigint",
      references: "refresh_tokens",
      onDelete: "SET NULL",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.createIndex("refresh_tokens", ["user_id", "revoked_at"], {
    name: "idx_refresh_tokens_user_active",
  });
  pgm.createIndex("refresh_tokens", "family_id", {
    name: "idx_refresh_tokens_family",
  });
  pgm.createIndex("refresh_tokens", "expires_at", {
    name: "idx_refresh_tokens_expires_at",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("refresh_tokens");
  pgm.dropColumn("users", "token_version");
};
```

- [ ] **Step 4: Jalankan test dan pastikan hijau**

Run: `npm run test:db -- --test-name-pattern "refresh_tokens|token_version|migration"`
Expected: semua test yang relevan PASS.

- [ ] **Step 5: Verifikasi suite DB penuh**

Run: `npm run test:db`
Expected: seluruh suite lulus, termasuk migrasi dari database kosong dengan 9 migrasi.

---

### Task 2: Konfigurasi origin, cookie refresh, dan CSRF guard

**Files:**
- Create: `src/config/origins.js`
- Create: `src/utils/refreshCookie.js`
- Create: `src/middlewares/requireTrustedOrigin.js`
- Modify: `src/app.js:30-45`
- Modify: `src/constants/auth.js`
- Modify: `package.json`, `package-lock.json`
- Test: `tests/auth/refresh-cookie.test.js` (baru)
- Test: `tests/auth/origin-guard.test.js` (baru)

**Interfaces:**
- Produces: `ALLOWED_ORIGINS: readonly string[]`
- Produces: `isAllowedOrigin(origin: unknown): boolean`
- Produces: `resolveRefreshCookieSettings({ portal, env }): { name, path, httpOnly, secure, sameSite }`
- Produces: `setRefreshCookie(res, { portal, token, expiresAt, env }): void`
- Produces: `clearRefreshCookie(res, { portal, env }): void`
- Produces: `readRefreshCookie(req, { portal }): string | null`
- Produces: `USER_REFRESH_COOKIE`, `ADMIN_REFRESH_COOKIE`, `REFRESH_COOKIE_PATHS`, `REFRESH_PORTALS` di `src/constants/auth.js`.

- [ ] **Step 1: Tambahkan dependency cookie**

Run: `npm install cookie@^0.7.2 --save`
Expected: `cookie` masuk `dependencies`; package-lock diperbarui.

- [ ] **Step 2: Tulis test cookie dan origin yang gagal**

Di `tests/auth/refresh-cookie.test.js`:

```js
test("cookie user produksi memakai Secure dan SameSite none", () => {
  const settings = resolveRefreshCookieSettings({
    portal: "user",
    env: { NODE_ENV: "production" },
  });
  assert.deepEqual(settings, {
    name: "fastshop_user_refresh",
    path: "/api/auth",
    httpOnly: true,
    secure: true,
    sameSite: "none",
  });
});

test("cookie admin non-produksi memakai path admin dan SameSite lax", () => {
  const settings = resolveRefreshCookieSettings({
    portal: "admin",
    env: { NODE_ENV: "development" },
  });
  assert.equal(settings.name, "fastshop_admin_refresh");
  assert.equal(settings.path, "/api/admin/auth");
  assert.equal(settings.secure, false);
  assert.equal(settings.sameSite, "lax");
});

test("setRefreshCookie mengirim maxAge dari expiresAt", () => {
  const calls = [];
  const res = { cookie: (...args) => calls.push(args) };
  const expiresAt = new Date(Date.now() + 60_000);
  setRefreshCookie(res, { portal: "user", token: "raw-token", expiresAt });
  assert.equal(calls[0][0], "fastshop_user_refresh");
  assert.equal(calls[0][1], "raw-token");
  assert.ok(calls[0][2].maxAge > 59_000 && calls[0][2].maxAge <= 60_000);
});

test("readRefreshCookie membaca cookie yang benar dan null jika tidak ada", () => {
  const req = { headers: { cookie: "a=1; fastshop_user_refresh=abc; b=2" } };
  assert.equal(readRefreshCookie(req, { portal: "user" }), "abc");
  assert.equal(readRefreshCookie({ headers: {} }, { portal: "user" }), null);
});

test("clearRefreshCookie memakai opsi yang sama tanpa maxAge", () => {
  const calls = [];
  const res = { clearCookie: (...args) => calls.push(args) };
  clearRefreshCookie(res, { portal: "user", env: { NODE_ENV: "production" } });
  assert.equal(calls[0][0], "fastshop_user_refresh");
  assert.equal(calls[0][1].path, "/api/auth");
  assert.equal(calls[0][1].secure, true);
  assert.equal(calls[0][1].sameSite, "none");
  assert.equal(Object.hasOwn(calls[0][1], "maxAge"), false);
});

test("COOKIE_SECURE dan COOKIE_SAME_SITE menimpa default environment", () => {
  const settings = resolveRefreshCookieSettings({
    portal: "user",
    env: { NODE_ENV: "production", COOKIE_SECURE: "false", COOKIE_SAME_SITE: "lax" },
  });
  assert.equal(settings.secure, false);
  assert.equal(settings.sameSite, "lax");
});
```

Di `tests/auth/origin-guard.test.js`, buat Express app kecil (jangan mengimpor `src/app` agar tidak menyentuh DB) dengan route `POST /cookie` yang memakai `requireTrustedOrigin` dan `app.listen(0)`, lalu assertion lewat `fetch`:

- origin `http://localhost:5173` -> 200,
- tanpa `Origin` -> 403 JSON `{ code: 403 }`,
- `https://evil.example` -> 403.

- [ ] **Step 3: Jalankan test dan pastikan gagal**

Run: `npm test -- tests/auth/refresh-cookie.test.js tests/auth/origin-guard.test.js`
Expected: module belum ada / `resolveRefreshCookieSettings is not defined`.

- [ ] **Step 4: Implementasikan konfigurasi dan utilitas**

- `src/config/origins.js` memuat lima origin yang sekarang ada di `src/app.js` dan mengekspor `ALLOWED_ORIGINS` (frozen) serta `isAllowedOrigin`.
- `src/app.js` mengganti array literal CORS dengan `origin: ALLOWED_ORIGINS`.
- `src/utils/refreshCookie.js` memakai `cookie.parse`; `secure` mengikuti `COOKIE_SECURE` bila diisi,否则 `NODE_ENV === "production"`; `sameSite` mengikuti `COOKIE_SAME_SITE` yang valid, default produksi `none`, lainnya `lax`.
- `setRefreshCookie` memanggil `res.cookie(name, token, { ...settings, maxAge })`.
- `clearRefreshCookie` memanggil `res.clearCookie(name, settings)` tanpa `maxAge`.
- `readRefreshCookie` memakai `cookie.parse(req.headers.cookie || "")[name] ?? null`.
- `requireTrustedOrigin` mengembalikan `403 { code: 403, message: "Origin tidak diizinkan." }` bila origin tidak ada/tidak cocok.

- [ ] **Step 5: Jalankan test dan pastikan hijau**

Run: `npm test -- tests/auth/refresh-cookie.test.js tests/auth/origin-guard.test.js`
Expected: semua PASS.

- [ ] **Step 6: Verifikasi suite non-DB penuh**

Run: `npm test`
Expected: seluruh test non-DB lulus; test DB tetap skip.

---

### Task 3: Service token akses dan refresh

**Files:**
- Create: `src/services/authTokenService.js`
- Test: `tests/services/authTokenService.test.js` (baru)

**Interfaces:**
- Produces: `hashRefreshToken(token: string): string`
- Produces: `readRefreshTtlSeconds(portal: "user"|"admin", env = process.env): number`
- Produces: `createAccessToken({ user, portal, env = process.env }): string`
  - `user` wajib memiliki `id`, `email`, `role`, `token_version`.
  - Payload: `{ userId, email, role, type: portal, tokenVersion: user.token_version }`.
- Produces: `issueRefreshToken({ userId, portal, tokenVersion, env = process.env }): Promise<{ token, expiresAt }>`
- Produces: `rotateRefreshToken({ token, portal, env = process.env }): Promise<{ token, accessToken, expiresAt, user }>`
- Produces: `revokeRefreshTokenFamily({ token, portal }): Promise<boolean>`
- Produces: `revokeAllRefreshTokens({ userId, client = db }): Promise<number>`

- [ ] **Step 1: Tulis test pure dan DB yang gagal**

Di `tests/services/authTokenService.test.js`:

```js
test("hashRefreshToken deterministik dan 64 hex", () => {
  const first = hashRefreshToken("token-mentah");
  assert.equal(first, hashRefreshToken("token-mentah"));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, hashRefreshToken("token-lain"));
});

test("createAccessToken memuat tokenVersion dan type portal", () => {
  const token = createAccessToken({
    user: { id: 7, email: "u@example.com", role: "user", token_version: 3 },
    portal: "user",
    env: { JWT_SECRET: "secret", JWT_EXPIRES_IN: "15m" },
  });
  const decoded = jwt.verify(token, "secret");
  assert.equal(decoded.userId, 7);
  assert.equal(decoded.type, "user");
  assert.equal(decoded.tokenVersion, 3);
});

test("issueRefreshToken menyimpan hash, bukan token mentah", { skip: !runDbTests }, async () => {
  // buat user; issue; query baris; assert token_hash === hashRefreshToken(token)
  // assert token_hash !== token, portal, token_version, expires_at > NOW()
});

test("rotasi mencabut token lama dan mempertahankan family", { skip: !runDbTests }, async () => {
  // issue -> rotate -> token lama 401/revoked, token baru aktif, family sama,
  // replaced_by_id terisi, accessToken dapat diverifikasi
});

test("replay token lama mencabut seluruh family", { skip: !runDbTests }, async () => {
  // issue -> rotate -> rotate lagi dengan token lama -> error 401
  // token hasil rotasi pertama juga harus gagal
});

test("refresh kedaluwarsa dan token_version tidak cocok ditolak", { skip: !runDbTests }, async () => {
  // set expires_at masa lalu -> 401
  // issue dengan versi 1, naikkan users.token_version -> 401 dan family dicabut
});

test("revoke family dan revoke all mencabut baris aktif", { skip: !runDbTests }, async () => {
  // issue dua family; revoke satu; family lain tetap aktif; revokeAll -> nol aktif
});

test("portal isolation menolak token portal lain", { skip: !runDbTests }, async () => {
  // issue portal admin, rotate dengan portal user -> 401
});

test("dua rotasi paralel tidak menghasilkan 500", { skip: !runDbTests }, async () => {
  // issue satu token, Promise.allSettled dua rotate dengan token yang sama.
  // Tidak ada rejection selain HttpError 401; minimal satu request sukses;
  // tidak ada baris aktif tersisa di family tersebut.
});
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `npm run test:db -- tests/services/authTokenService.test.js`
Expected: module belum ada / fungsi belum terdefinisi.

- [ ] **Step 3: Implementasikan service**

Detail yang mengikat:

- Gunakan `REFRESH_PORTALS` dari `src/constants/auth.js` untuk validasi portal.
- Token mentah: `crypto.randomBytes(32).toString("base64url")`.
- Hash: `crypto.createHash("sha256").update(token).digest("hex")`.
- Family: `crypto.randomUUID()`.
- Error 401 memakai `HttpError` dari `src/utils/httpError.js` agar error handler
  mengembalikan JSON `{ code: 401, message }`.
- TTL user: `REFRESH_TOKEN_TTL_SECONDS` default `2592000`; admin: `ADMIN_REFRESH_TOKEN_TTL_SECONDS` default `28800`; nilai non-positif kembali ke default.
- Access token user memakai `JWT_SECRET` + `JWT_EXPIRES_IN` default `15m`; admin memakai `ADMIN_JWT_SECRET` + `ADMIN_JWT_EXPIRES_IN` default `30m`.
- `issueRefreshToken` melakukan satu `INSERT` dan mengembalikan `{ token, expiresAt }`.
- `rotateRefreshToken` memakai transaksi `db.pool.connect()`:
  1. `SELECT` baris refresh + `users` dengan `FOR UPDATE OF rt` berdasarkan `token_hash` dan `portal`.
  2. Tidak ditemukan, kedaluwarsa, role tidak cocok, atau `rt.token_version !== u.token_version` -> `401` dengan pesan `"Refresh token tidak valid atau sudah kedaluwarsa."`.
  3. `revoked_at` sudah terisi -> cabut seluruh family, commit, lalu `401` dan log `refresh_token_reuse_detected` tanpa token.
  4. Tandai baris lama `revoked_at = NOW()`, insert baris baru dengan family yang sama dan versi user saat ini, isi `replaced_by_id`, commit.
  5. Kembalikan token baru, `accessToken` baru, `expiresAt`, dan data user minimal `{ id, name, email, role, token_version }`.
- `revokeRefreshTokenFamily` mencari `family_id` dari hash+portal lalu mencabut semua baris aktif di family itu; return `rowCount > 0`.
- `revokeAllRefreshTokens` menerima `client` (default `db`) agar bisa dipakai dalam transaksi password change.

- [ ] **Step 4: Jalankan test dan pastikan hijau**

Run: `npm run test:db -- tests/services/authTokenService.test.js`
Expected: semua test PASS.

- [ ] **Step 5: Verifikasi suite DB penuh**

Run: `npm run test:db`
Expected: seluruh suite lulus.

---

### Task 4: Login menerbitkan refresh cookie dan access token ber-version

**Files:**
- Modify: `src/services/authService.js:42-92`
- Modify: `src/services/adminAuthService.js:9-59`
- Modify: `src/controllers/authController.js:33-75`
- Modify: `src/controllers/adminAuthController.js:3-24`
- Modify: `tests/helpers/api.js:31-108`
- Test: `tests/auth/refresh-token.test.js` (baru; bagian login)

**Interfaces:**
- Consumes: `createAccessToken`, `issueRefreshToken` dari Task 3; `setRefreshCookie` dari Task 2.
- Produces: `authService.loginUser` dan `adminAuthService.loginAdmin` mengembalikan `{ user|admin, token, refreshToken, refreshExpiresAt }`.
- Produces: response body login tetap `{ code, message, data: { user|admin, token } }`.
- Produces: `tests/helpers/api.js` menambahkan `setCookie` pada hasil `request`, opsi `{ cookie, origin }`, dan helper `getCookieValue(response, name)`.

- [ ] **Step 1: Tulis test login yang gagal**

Di `tests/auth/refresh-token.test.js` (definisikan `dbTest` seperti file auth lain,
dan impor `jwt` serta `hashRefreshToken`):

```js
dbTest("login user menetapkan cookie refresh HttpOnly tanpa refresh token di body", async () => {
  const response = await loginUser(baseUrl, userCredentials);
  assert.equal(response.status, 200);
  assert.ok(response.body.data.token);
  assert.equal(Object.hasOwn(response.body.data, "refreshToken"), false);
  assert.equal(Object.hasOwn(response.body.data, "refresh_token"), false);

  const cookie = response.setCookie.find((item) =>
    item.startsWith("fastshop_user_refresh="),
  );
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Path=\/api\/auth/i);
  assert.match(cookie, /SameSite=Lax/i);
});

dbTest("login admin menetapkan cookie admin", async () => {
  // sama, name fastshop_admin_refresh, path /api/admin/auth
});

dbTest("access token login memuat tokenVersion", async () => {
  const decoded = jwt.decode(login.body.data.token);
  assert.equal(decoded.tokenVersion, 1);
});

dbTest("cookie refresh disimpan sebagai hash di database", async () => {
  const raw = getCookieValue(login, "fastshop_user_refresh");
  const row = await db.query(
    "SELECT token_hash, portal, token_version FROM refresh_tokens WHERE user_id = $1",
    [user.id],
  );
  assert.equal(row.rows[0].token_hash, hashRefreshToken(raw));
  assert.notEqual(row.rows[0].token_hash, raw);
  assert.equal(row.rows[0].portal, "user");
  assert.equal(row.rows[0].token_version, 1);
});
```

Tambahkan `jwt` dan `hashRefreshToken` import di test.

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `npm run test:db -- tests/auth/refresh-token.test.js`
Expected: tidak ada `Set-Cookie`, body belum memiliki tokenVersion, dan tabel refresh belum dipakai.

- [ ] **Step 3: Implementasikan login**

- Query login user/admin menambahkan `token_version`.
- Ganti penandatanganan JWT langsung dengan `createAccessToken({ user, portal })`.
- Panggil `issueRefreshToken({ userId, portal, tokenVersion })`.
- Controller memanggil `setRefreshCookie(res, { portal, token, expiresAt })`.
- Controller hanya mengirim `data: { user: loginData.user, token: loginData.token }` (jangan spread seluruh `loginData`).
- `tests/helpers/api.js` menyimpan `response.headers.getSetCookie()` ke `setCookie`, menambahkan opsi `cookie` dan `origin`, dan mengekspor `getCookieValue`.

- [ ] **Step 4: Jalankan test dan pastikan hijau**

Run: `npm run test:db -- tests/auth/refresh-token.test.js`
Expected: test login PASS.

- [ ] **Step 5: Pastikan test lama tidak berubah perilaku**

Run: `npm test`
Expected: seluruh test non-DB lulus; test login lama tetap memakai `body.data.token`.

---

### Task 5: Endpoint refresh user dan admin

**Files:**
- Modify: `src/routes/authRoutes.js`
- Modify: `src/routes/adminAuthRoutes.js`
- Modify: `src/controllers/authController.js`
- Modify: `src/controllers/adminAuthController.js`
- Modify: `src/services/authService.js`
- Modify: `src/services/adminAuthService.js`
- Modify: `src/middlewares/rateLimit.js`
- Test: `tests/auth/refresh-token.test.js` (lanjutan)
- Test: `tests/auth/refresh-rate-limit.test.js` (baru)

**Interfaces:**
- Produces: `authService.refreshUserSession(refreshToken): Promise<{ accessToken, refreshToken, refreshExpiresAt }>`
- Produces: `adminAuthService.refreshAdminSession(refreshToken): Promise<{ accessToken, refreshToken, refreshExpiresAt }>`
- Produces: `refreshLimiter` di `src/middlewares/rateLimit.js`.
- Routes: `POST /api/auth/refresh`, `POST /api/admin/auth/refresh`.
- Response sukses: `200 { code: 200, message: "Token berhasil diperbarui", data: { token } }`.

- [ ] **Step 1: Tulis test refresh yang gagal**

Tambahkan test:

- `refresh user merotasi cookie dan access token`: login, refresh dengan cookie + Origin, 200, `Set-Cookie` baru, access token baru bisa dipakai `/api/auth/me`, cookie lama berbeda.
- `refresh user menolak token lama setelah rotasi`: refresh kedua dengan cookie lama -> 401.
- `replay refresh token lama mencabut family`: refresh dengan token lama lagi, lalu cookie hasil rotasi pertama -> 401; query `revoked_at` semua baris family terisi.
- `refresh tanpa cookie 401`, `refresh dengan origin asing 403`, `refresh dengan origin diizinkan 200`.
- `refresh token kedaluwarsa 401 dan cookie dibersihkan`: update `expires_at = NOW() - INTERVAL '1 second'`, refresh, assert `Set-Cookie` berisi `Max-Age=0` atau `Expires` lampau.
- `refresh admin memakai cookie admin` dan `refresh menolak cookie portal lain`.

Di `tests/auth/refresh-rate-limit.test.js`, set `RATE_LIMIT_REFRESH_MAX=2` sebelum require helper, login, lalu tiga refresh berturut-turut: dua `200`, ketiga `429` dengan `Retry-After`.

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `npm run test:db -- tests/auth/refresh-token.test.js tests/auth/refresh-rate-limit.test.js`
Expected: route `/refresh` 404 atau cookie tidak berotasi.

- [ ] **Step 3: Implementasikan route, controller, service, dan limiter**

- `refreshLimiter` memakai `createRateLimiter` dengan `RATE_LIMIT_REFRESH_WINDOW_MS` default `900000` dan `RATE_LIMIT_REFRESH_MAX` default `60`, key IP.
- Route memakai `requireTrustedOrigin` lalu `refreshLimiter`.
- Controller membaca `readRefreshCookie`, memanggil service, menetapkan cookie baru, dan mengembalikan `data.token`.
- Jika service gagal, controller memanggil `clearRefreshCookie` lalu `next(error)`.
- Service hanya memanggil `rotateRefreshToken({ token, portal })` dan memetakan hasilnya.

- [ ] **Step 4: Jalankan test dan pastikan hijau**

Run: `npm run test:db -- tests/auth/refresh-token.test.js tests/auth/refresh-rate-limit.test.js`
Expected: semua PASS.

---

### Task 6: Endpoint logout user dan admin

**Files:**
- Modify: `src/routes/authRoutes.js`
- Modify: `src/routes/adminAuthRoutes.js`
- Modify: `src/controllers/authController.js`
- Modify: `src/controllers/adminAuthController.js`
- Modify: `src/services/authService.js`
- Modify: `src/services/adminAuthService.js`
- Test: `tests/auth/refresh-token.test.js` (lanjutan)

**Interfaces:**
- Produces: `authService.logoutUser(refreshToken): Promise<boolean>`
- Produces: `adminAuthService.logoutAdmin(refreshToken): Promise<boolean>`
- Routes: `POST /api/auth/logout`, `POST /api/admin/auth/logout`.
- Response sukses: `200 { code: 200, message: "Logout berhasil" }`.
- Cookie selalu dihapus, termasuk saat tidak ada cookie atau token tidak dikenal.

- [ ] **Step 1: Tulis test logout yang gagal**

- `logout user mencabut refresh token dan menghapus cookie`: login, logout dengan Origin, 200, `Set-Cookie` pembersihan, refresh dengan cookie lama -> 401.
- `logout idempoten tanpa cookie`: dua kali `200`.
- `logout dengan origin asing 403`.
- `logout admin mencabut sesi admin`.
- `access token tetap berlaku sampai kedaluwarsa setelah logout`: setelah logout, `/api/auth/me` dengan access token masih 200 (mendokumentasikan TTL pendek).

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `npm run test:db -- --test-name-pattern "logout" tests/auth/refresh-token.test.js`
Expected: route 404 / refresh token masih aktif.

- [ ] **Step 3: Implementasikan logout**

- Route memakai `requireTrustedOrigin`.
- Controller membaca cookie; jika ada, memanggil service; selalu `clearRefreshCookie` di `finally`; response `200`.
- Service memanggil `revokeRefreshTokenFamily({ token, portal })`.

- [ ] **Step 4: Jalankan test dan pastikan hijau**

Run: `npm run test:db -- --test-name-pattern "logout" tests/auth/refresh-token.test.js`
Expected: semua test logout PASS.

- [ ] **Step 5: Jalankan suite auth penuh**

Run: `npm run test:db -- tests/auth`
Expected: seluruh test auth lulus.

---

### Task 7: Middleware menolak access token dengan versi salah

**Files:**
- Modify: `src/middlewares/authMiddleware.js:41-115`
- Test: `tests/auth/token-version.test.js` (baru)

**Interfaces:**
- Consumes: `users.token_version` dari Task 1 dan klaim `tokenVersion` dari Task 4.
- Produces: `verifyUserToken` dan `verifyAdminToken` menjadi async dan menolak `401` bila versi/role di DB tidak cocok.
- Perilaku kompatibilitas: token tanpa klaim `tokenVersion` tetap diterima sampai `exp` habis.

- [ ] **Step 1: Tulis test token version yang gagal**

- `access token user ditolak setelah token_version dinaikkan`: login, `UPDATE users SET token_version = token_version + 1`, `/api/auth/me` -> 401.
- `access token admin ditolak setelah token_version dinaikkan`: sama untuk admin.
- `token lama tanpa klaim tokenVersion tetap diterima`: `signToken({ userId, email, role, type }, secret)` tanpa `tokenVersion`, `/api/auth/me` -> 200.
- `perubahan role di database membatalkan token`: ubah role user menjadi admin, token user lama -> 401.
- `token dengan tokenVersion salah ditolak`: sign payload dengan `tokenVersion: 99` -> 401.
- `token valid dengan versi benar tetap diterima`.

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `npm run test:db -- tests/auth/token-version.test.js`
Expected: request masih 200 setelah versi dinaikkan.

- [ ] **Step 3: Implementasikan pengecekan versi**

- Tambahkan helper internal `isTokenVersionValid(decoded)`:
  - jika `decoded.tokenVersion === undefined`, return `true` (legacy),
  - query `SELECT role, token_version FROM users WHERE id = $1`,
  - return `row && row.role === decoded.role && row.token_version === decoded.tokenVersion`.
- Di `verifyUserToken` dan `verifyAdminToken`, verifikasi JWT dan klaim role/type dulu; lalu `await isTokenVersionValid`.
- Jika tidak valid -> `401` dengan pesan token tidak valid yang sudah ada.
- Jika query DB melempar error -> `next(error)` (500), jangan disamarkan menjadi 401.
- Jangan mengubah `verifyAuthToken` dan `authorize`.

- [ ] **Step 4: Jalankan test dan pastikan hijau**

Run: `npm run test:db -- tests/auth/token-version.test.js`
Expected: semua PASS.

- [ ] **Step 5: Pastikan test non-DB lama tetap lulus**

Run: `npm test`
Expected: seluruh test non-DB lulus; token sintetis tanpa klaim tetap diterima.

---

### Task 8: Endpoint ganti password user dan admin

**Files:**
- Create: `src/services/passwordService.js`
- Modify: `src/validation/authSchemas.js`
- Modify: `src/routes/authRoutes.js`
- Modify: `src/routes/adminAuthRoutes.js`
- Modify: `src/controllers/authController.js`
- Modify: `src/controllers/adminAuthController.js`
- Modify: `src/middlewares/rateLimit.js`
- Test: `tests/auth/password-change.test.js` (baru)

**Interfaces:**
- Produces: `changePassword({ userId, expectedRole, currentPassword, newPassword }): Promise<{ tokenVersion }>`
- Produces: `changePasswordBody` Zod schema di `src/validation/authSchemas.js`.
- Produces: `passwordLimiter` di `src/middlewares/rateLimit.js`, key `user:<id>`.
- Routes: `PUT /api/auth/password`, `PUT /api/admin/auth/password`.
- Response sukses: `200 { code: 200, message: "Password berhasil diubah. Silakan login ulang." }`.

- [ ] **Step 1: Tulis test ganti password yang gagal**

Set `process.env.RATE_LIMIT_PASSWORD_MAX = "100"` di bagian atas file test,
sebelum `require("../helpers/api")`, agar beberapa skenario tidak saling
menghabiskan limit per user.

- `ganti password user menolak password saat ini yang salah` -> 400.
- `ganti password user menolak password baru yang sama` -> 400.
- `ganti password user memvalidasi aturan password baru` -> 400 untuk pendek/lemah/>72 byte.
- `ganti password user mencabut semua sesi`: login dua kali (dua family), ganti password, semua baris aktif user `revoked_at` terisi; access token lama `/api/auth/me` 401; refresh cookie lama 401; cookie response dibersihkan.
- `ganti password user menolak login password lama dan menerima password baru`: login lama 401, login baru 200, access token baru 200.
- `ganti password admin mencabut semua sesi admin`: sama untuk admin.
- `ganti password membutuhkan access token` -> 401.

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `npm run test:db -- tests/auth/password-change.test.js`
Expected: route 404.

- [ ] **Step 3: Implementasikan schema, service, limiter, route, controller**

- `changePasswordBody`: `current_password` wajib non-empty; `new_password` memakai aturan register (min 8, maks 72 byte, huruf + angka).
- `passwordLimiter`: `RATE_LIMIT_PASSWORD_WINDOW_MS` default `3600000`, `RATE_LIMIT_PASSWORD_MAX` default `10`, key `user:${req.user.userId}`; fallback IP.
- `changePassword`:
  1. `SELECT password, role FROM users WHERE id = $1 AND role = $2`.
  2. Tidak ada -> `404 "Akun tidak ditemukan."`.
  3. `comparePassword(currentPassword, row.password)` gagal -> `400 "Password saat ini tidak valid."`.
  4. `comparePassword(newPassword, row.password)` true -> `400 "Password baru harus berbeda dari password saat ini."`.
  5. `bcrypt.hash(newPassword, 10)`.
  6. Transaksi: update password + `token_version = token_version + 1` + `updated_at = NOW()`, lalu `revokeAllRefreshTokens({ userId, client })`.
  7. Return `{ tokenVersion }`.
- Route: `verifyUserToken`/`verifyAdminToken`, lalu `passwordLimiter`, lalu `validate({ body: changePasswordBody })`, lalu controller.
- Controller memanggil service, `clearRefreshCookie(res, { portal })`, dan response sukses.

- [ ] **Step 4: Jalankan test dan pastikan hijau**

Run: `npm run test:db -- tests/auth/password-change.test.js`
Expected: semua PASS.

- [ ] **Step 5: Verifikasi suite auth penuh**

Run: `npm run test:db -- tests/auth`
Expected: seluruh test auth lulus.

---

### Task 9: CLI admin update mencabut sesi

**Files:**
- Modify: `scripts/lib/admin.js:144-156`
- Modify: `tests/admin.test.js:168-203`

**Interfaces:**
- Consumes: `refresh_tokens` dan `users.token_version` dari Task 1.
- Produces: `createOrUpdateAdmin({ update: true })` menaikkan `token_version` satu dan menghapus semua refresh token admin tersebut dalam satu statement.

- [ ] **Step 1: Tulis test CLI yang gagal**

Ubah test `createOrUpdateAdmin dengan --update memperbarui password admin`:

```js
// setelah create admin pertama:
await client.query(
  `INSERT INTO refresh_tokens
     (user_id, token_hash, family_id, portal, token_version, expires_at)
   VALUES ($1, $2, gen_random_uuid(), 'admin', 1, NOW() + INTERVAL '1 hour')`,
  [created.admin.id, "b".repeat(64)],
);

// setelah update:
const row = await client.query(
  "SELECT token_version FROM users WHERE id = $1",
  [result.admin.id],
);
assert.equal(row.rows[0].token_version, 2);

const tokens = await client.query(
  "SELECT COUNT(*)::int AS count FROM refresh_tokens WHERE user_id = $1",
  [result.admin.id],
);
assert.equal(tokens.rows[0].count, 0);
```

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `npm run test:db -- --test-name-pattern "memperbarui password" tests/admin.test.js`
Expected: `token_version` masih 1 dan refresh token masih ada.

- [ ] **Step 3: Implementasikan update revocation**

Ganti query update di `createOrUpdateAdmin` dengan satu CTE:

```sql
WITH updated AS (
  UPDATE users
  SET name = $1,
      password = $2,
      phone_number = $3,
      updated_at = NOW(),
      token_version = token_version + 1
  WHERE id = $4
  RETURNING id, name, email, role, updated_at
), revoked AS (
  DELETE FROM refresh_tokens
  WHERE user_id = (SELECT id FROM updated)
)
SELECT * FROM updated;
```

Pertahankan bentuk return `{ action: "updated", admin }` dan perilaku create/exists.

- [ ] **Step 4: Jalankan test dan pastikan hijau**

Run: `npm run test:db -- tests/admin.test.js`
Expected: semua test admin lulus, termasuk create, exists, update, dan non-admin conflict.

- [ ] **Step 5: Verifikasi kompatibilitas script**

Run: `node --check scripts/lib/admin.js`
Expected: tidak ada syntax error; test `npm run seed:admin` tidak dijalankan karena membutuhkan `.env` nyata.

---

### Task 10: OpenAPI 44 operasi dan test sinkronisasi

**Files:**
- Modify: `docs/openapi.yaml`
- Modify: `tests/docs/openapi.test.js`

**Interfaces:**
- Consumes: enam route baru dari Task 5, 6, 8.
- Produces: security schemes `userRefreshCookie` dan `adminRefreshCookie`.
- Produces: schema `ChangePasswordRequest`, `RefreshResponse`, `LogoutResponse` (atau `MessageResponse` yang sudah ada).

- [ ] **Step 1: Tulis ekspektasi OpenAPI yang gagal**

Di `tests/docs/openapi.test.js`:

- Tambahkan enam operasi ke `REQUIRED_OPERATIONS`:

```js
["post", "/api/auth/refresh"],
["post", "/api/auth/logout"],
["put", "/api/auth/password"],
["post", "/api/admin/auth/refresh"],
["post", "/api/admin/auth/logout"],
["put", "/api/admin/auth/password"],
```

- Ubah test jumlah operasi menjadi 44.
- Tambahkan assertion `api.components.securitySchemes.userRefreshCookie` dan `adminRefreshCookie`.
- Ubah `operasi admin memakai adminBearer` agar melewati `/api/admin/auth/refresh` dan `/api/admin/auth/logout`, lalu assert keduanya memakai `[{ adminRefreshCookie: [] }]`.
- Tambahkan `/api/auth/password` ke daftar operasi userBearer.
- Assert `/api/auth/refresh` dan `/api/auth/logout` memakai `[{ userRefreshCookie: [] }]`.
- Tambahkan assertion response `401`/`403` untuk operasi cookie dan `Set-Cookie` pada login/refresh/logout.

- [ ] **Step 2: Jalankan test dan pastikan gagal**

Run: `npm test -- tests/docs/openapi.test.js`
Expected: operasi baru hilang dari spec, jumlah masih 38, security scheme cookie belum ada.

- [ ] **Step 3: Perbarui spec**

Tambahkan:

- `components.securitySchemes.userRefreshCookie` dan `adminRefreshCookie` bertipe `apiKey`, `in: cookie`.
- Tiga path user dan tiga path admin dengan method, tag, operationId unik, summary, security, parameter header `Origin` untuk refresh/logout, response `200`, `400` (password), `401`, `403`, `429`.
- Schema `ChangePasswordRequest` dengan `current_password` dan `new_password`; `new_password` minimal 8 karakter dan deskripsi maksimal 72 byte + huruf/angka.
- Schema response refresh `{ data: { token } }`, logout `{ code, message }`, dan header `Set-Cookie` pada login/refresh/logout.
- Deskripsi login diperbarui: access token TTL baru dan refresh token dikirim lewat cookie `HttpOnly`.
- Contoh token tetap placeholder aman, bukan JWT asli.

- [ ] **Step 4: Jalankan test dan validasi spec**

Run: `npm test -- tests/docs/openapi.test.js`
Expected: 44 operasi, exact-set route, security matrix, dan header PASS.

Run: `npm run docs:validate`
Expected: `OpenAPI valid`.

- [ ] **Step 5: Jalankan suite non-DB penuh**

Run: `npm test`
Expected: seluruh test non-DB lulus.

---

### Task 11: README, env, dokumentasi proyek, dan verifikasi akhir

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/to-do/todo-perbaikan.md`
- Modify: `docs/analisa/analisis-project.md`
- Modify: `.superpowers/sdd/todo-perbaikan/progress.md` (gitignored)

**Interfaces:**
- Consumes: seluruh hasil Task 1–10.
- Produces: dokumentasi auth yang sesuai perilaku baru dan catatan verifikasi final.

- [ ] **Step 1: Perbarui `.env.example`**

Ubah:

```dotenv
JWT_EXPIRES_IN=15m
ADMIN_JWT_EXPIRES_IN=30m
```

Tambahkan:

```dotenv
# Refresh token TTL (detik)
REFRESH_TOKEN_TTL_SECONDS=2592000
ADMIN_REFRESH_TOKEN_TTL_SECONDS=28800

# Cookie refresh token.
# Produksi lintas site: COOKIE_SECURE=true dan COOKIE_SAME_SITE=none.
# Localhost HTTP: COOKIE_SECURE=false dan COOKIE_SAME_SITE=lax.
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax

# Rate limit refresh dan ganti password
RATE_LIMIT_REFRESH_WINDOW_MS=900000
RATE_LIMIT_REFRESH_MAX=60
RATE_LIMIT_PASSWORD_WINDOW_MS=3600000
RATE_LIMIT_PASSWORD_MAX=10
```

- [ ] **Step 2: Perbarui README**

Tambahkan/ubah:

- Ringkasan auth: login mengembalikan access token + cookie refresh `HttpOnly`; refresh token tidak ada di body.
- Tabel endpoint auth user dan admin dengan enam endpoint baru.
- TTL default: access user 15m, admin 30m; refresh user 30 hari, admin 8 jam.
- Rotasi, deteksi replay, logout, ganti password, `token_version`, dan konsekuensi login ulang.
- Contoh curl login dengan `-c cookies.txt`, refresh dengan `-b cookies.txt` dan header `Origin`, logout, dan ganti password.
- Catatan CORS: frontend wajib `credentials: "include"`; produksi memakai `SameSite=None; Secure`; localhost memakai `Lax`.
- Env baru dan peringatan produksi.
- Perubahan CLI admin `--update` yang mencabut sesi.
- Jumlah OpenAPI menjadi 44 operasi.
- Urutan deploy: jalankan migrasi lebih dulu, lalu deploy kode; token lama tanpa
  klaim `tokenVersion` diterima sampai `exp` habis.

- [ ] **Step 3: Tandai P2-06 selesai di checklist**

Di `docs/to-do/todo-perbaikan.md`, tambahkan bagian **Progres 17 November 2026** dengan gaya P2-01/P2-02:

- migrasi dan tabel,
- endpoint baru,
- rotasi/replay/revocation,
- cookie dan CSRF,
- CLI admin,
- file yang berubah,
- langkah checklist `[x]`,
- Definition of Done `[x]`,
- hasil verifikasi aktual (isi setelah Step 4).

Di `docs/analisa/analisis-project.md`, ubah item P2:

```markdown
- ~~Audit log admin, refresh token/revocation.~~ (audit log admin selesai 16 November 2026; refresh token/revocation selesai 17 November 2026)
```

- [ ] **Step 4: Jalankan verifikasi akhir**

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

- `npm test`: 0 fail; test DB skip sesuai konfigurasi.
- `npm run test:db`: seluruh test lulus.
- coverage: di atas threshold 60% lines/branches/functions.
- lint: OK untuk seluruh file JavaScript.
- `docs:validate`: `OpenAPI valid`.
- audit: 0 critical/high; target 0 vulnerabilities.
- `git diff --check`: bersih.

Catat angka aktual (jumlah test, pass, skip, coverage, jumlah file lint) ke `docs/to-do/todo-perbaikan.md` dan ledger.

- [ ] **Step 5: Catat keputusan dan hasil review di ledger**

Tambahkan ke `.superpowers/sdd/todo-perbaikan/progress.md`:

- pilihan Approach A + cookie + user/admin,
- keputusan `SameSite=None; Secure` untuk produksi lintas site,
- kompatibilitas token lama tanpa `tokenVersion`,
- logout hanya mencabut refresh token; access token berlaku sampai TTL pendek,
- hasil test dan catatan migrasi production yang masih menunggu akses DB.

- [ ] **Step 6: Wording commit untuk pemilik project**

```text
feat(auth): add rotating refresh tokens and session revocation

- Add refresh_tokens table and users.token_version migration
- Issue HttpOnly refresh cookies and rotate opaque tokens with replay detection
- Add user/admin refresh, logout, and password change endpoints
- Revoke all sessions on password change and admin CLI password update
- Guard cookie endpoints with origin allowlist and rate limits
- Document 44 operations in OpenAPI and update auth docs
```
