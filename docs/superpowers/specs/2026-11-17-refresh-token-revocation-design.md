# Refresh Token, Rotasi, dan Revocation — Design

Tanggal: 17 November 2026
Status: menunggu approval
Task: P2-06 (`docs/to-do/todo-perbaikan.md`)

## 1. Ringkasan

P2-06 menutup kelemahan utama autentikasi saat ini: access token tidak dapat
dicabut sebelum kedaluwarsa. Desain ini menambahkan:

- refresh token opaque dengan rotasi dan deteksi replay,
- logout yang mencabut refresh token sesi tersebut,
- `token_version` pada `users` yang membatalkan seluruh access token saat
  password berubah,
- endpoint ganti password untuk user dan admin,
- pengecekan versi token pada setiap request ber-token,
- pengiriman refresh token melalui cookie `HttpOnly`,
- pembaruan CLI `seed:admin`/`create:admin` agar perubahan password juga
  mencabut semua sesi.

Keputusan yang sudah dipilih pemilik project:

1. Penyimpanan refresh token di tabel `refresh_tokens` dengan rotasi dan
   deteksi replay (Approach A).
2. Refresh token dikirim melalui cookie `HttpOnly`, bukan JSON body.
3. Cakupan lengkap: user dan admin.

## 2. Kondisi Saat Ini

- Login user (`src/services/authService.js`) dan admin
  (`src/services/adminAuthService.js`) hanya menerbitkan access JWT.
- Access token user default berlaku `1d`, admin `8h`.
- Middleware `verifyUserToken`/`verifyAdminToken` hanya memverifikasi signature
  dan klaim `role`/`type`; tidak ada pengecekan ke database.
- Tidak ada refresh token, logout, atau endpoint ganti password.
- `scripts/lib/admin.js` dapat mengganti password admin lewat `--update` tanpa
  mencabut sesi apa pun.
- CORS sudah memakai `credentials: true` dan origin eksplisit, tetapi belum ada
  parsing cookie maupun perlindungan CSRF.
- Kontrak OpenAPI memiliki 38 operasi dan dijaga exact-set test terhadap route
  Express.

## 3. Tujuan dan Non-Tujuan

### Tujuan

- Refresh token berumur panjang yang dapat dicabut dan dirotasi.
- Access token berumur pendek; password change membatalkan semua token seketika.
- Logout mencabut sesi refresh saat ini.
- Deteksi pemakaian ulang refresh token lama (indikasi pencurian).
- Perilaku konsisten untuk portal user dan admin.
- Tidak ada perubahan deployment (tetap Node/Express di Vercel, tanpa build
  step baru).

### Non-Tujuan

- Logout-all sebagai endpoint terpisah. Revoke semua sesi terjadi lewat ganti
  password; endpoint terpisah dapat ditambahkan nanti.
- Manajemen perangkat/sesi (daftar sesi, revoke sesi lain).
- Batas umur sesi absolut. Refresh token memakai masa berlaku geser (sliding)
  per rotasi.
- Pembersihan otomatis baris refresh token kedaluwarsa. Index disiapkan agar
  job operasional dapat ditambahkan nanti.
- Rate limit terdistribusi/Redis. Limiter tetap in-memory seperti komponen lain.
- Audit log untuk event auth (login/refresh/logout/ganti password).
- Penghapusan dead code `verifyAuthToken`/`authorize`; itu scope P2-07.
- Migrasi TypeScript (P2-04 ditunda).

## 4. Skema Database

Migrasi baru membuat satu kolom dan satu tabel.

### 4.1 `users.token_version`

```sql
ALTER TABLE users
  ADD COLUMN token_version integer NOT NULL DEFAULT 1;
```

- Nilai awal `1` untuk semua user lama.
- Dinaikkan satu setiap password berubah.
- Disalin ke access token sebagai klaim `tokenVersion`.
- Middleware membandingkan klaim dengan nilai DB.

### 4.2 Tabel `refresh_tokens`

| Kolom | Tipe | Aturan |
| :--- | :--- | :--- |
| `id` | `bigserial` | primary key |
| `user_id` | `bigint` | not null, FK `users(id)` on delete cascade |
| `token_hash` | `varchar(64)` | not null, unique; SHA-256 hex dari token mentah |
| `family_id` | `uuid` | not null; satu family per login/sesi |
| `portal` | `varchar(10)` | not null, check `user`/`admin` |
| `token_version` | `integer` | not null; versi user saat token diterbitkan |
| `expires_at` | `timestamptz` | not null |
| `revoked_at` | `timestamptz` | nullable |
| `replaced_by_id` | `bigint` | nullable, self-FK `refresh_tokens(id)` on delete set null |
| `created_at` | `timestamptz` | not null, default `now()` |

Index:

- unique index pada `token_hash` (lookup saat refresh),
- `idx_refresh_tokens_user_active` pada `(user_id, revoked_at)`,
- `idx_refresh_tokens_family` pada `(family_id)`,
- `idx_refresh_tokens_expires_at` pada `(expires_at)` untuk pembersihan nanti.

Token mentah **tidak pernah** disimpan. Token dibuat dari 32 byte acak
(`crypto.randomBytes(32).toString("base64url")`) dan hanya hash SHA-256 yang
masuk database.

## 5. Format Token

### Access token

Payload tetap kompatibel dengan token sekarang, ditambah satu klaim:

```json
{
  "userId": 123,
  "email": "user@example.com",
  "role": "user",
  "type": "user",
  "tokenVersion": 1
}
```

- User ditandatangani dengan `JWT_SECRET`, default baru `15m`.
- Admin ditandatangani dengan `ADMIN_JWT_SECRET`, default baru `30m`.
- `type` tetap `user`/`admin`.
- Token lama tanpa klaim `tokenVersion` tetap diterima sampai kedaluwarsa
  (lihat bagian Kompatibilitas).

### Refresh token

- Opaque, bukan JWT.
- 32 byte acak, base64url.
- Disimpan sebagai SHA-256 hex.
- Masa berlaku:
  - user: `REFRESH_TOKEN_TTL_SECONDS`, default `2592000` (30 hari),
  - admin: `ADMIN_REFRESH_TOKEN_TTL_SECONDS`, default `28800` (8 jam).
- Masa berlaku diperpanjang (sliding) setiap rotasi.
- Satu family per login. Rotasi mempertahankan `family_id`.

## 6. Cookie

Refresh token hanya dikirim melalui cookie; response body tidak memuat refresh
token.

| Properti | User | Admin |
| :--- | :--- | :--- |
| Nama | `fastshop_user_refresh` | `fastshop_admin_refresh` |
| Path | `/api/auth` | `/api/admin/auth` |
| HttpOnly | selalu `true` | selalu `true` |
| Secure | produksi `true` | produksi `true` |
| SameSite | produksi `none`, non-produksi `lax` | sama |
| Domain | tidak diset (host-only) | sama |
| Max-Age | TTL refresh token | TTL refresh token |

Catatan penting: frontend user (`https://fastshop-id.vercel.app`) dan admin
(`https://admin-fastshop.netlify.app`) berbeda site dengan API. Karena itu
produksi membutuhkan `SameSite=None; Secure`, dan frontend wajib mengirim
request dengan `credentials: "include"`. Di localhost, frontend dan API masih
same-site, sehingga `SameSite=Lax` dan `Secure=false` dipakai agar cookie tetap
bekerja di HTTP.

Override opsional:

- `COOKIE_SECURE=true|false`
- `COOKIE_SAME_SITE=strict|lax|none`

Default mengikuti `NODE_ENV`.

Parsing cookie memakai package `cookie` (`^0.7.2`) yang sudah tersedia sebagai
transitive dependency Express; package ini akan dideklarasikan sebagai direct
dependency. Penulisan/penghapusan cookie memakai `res.cookie` dan
`res.clearCookie` bawaan Express.

## 7. Kontrak API

Semua response mengikuti format yang sudah ada: `{ code, message, data? }`.

### 7.1 Endpoint baru user

| Method | Path | Auth | Keterangan |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/refresh` | cookie user | Rotasi refresh token, terbitkan access token baru |
| `POST` | `/api/auth/logout` | cookie user | Cabut family refresh token sesi ini |
| `PUT` | `/api/auth/password` | Bearer user | Ganti password, cabut semua sesi |

### 7.2 Endpoint baru admin

| Method | Path | Auth | Keterangan |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/admin/auth/refresh` | cookie admin | Rotasi refresh token admin |
| `POST` | `/api/admin/auth/logout` | cookie admin | Cabut family refresh token admin |
| `PUT` | `/api/admin/auth/password` | Bearer admin | Ganti password admin |

### 7.3 Perubahan endpoint login

`POST /api/auth/login` dan `POST /api/admin/auth/login`:

- Response body **tetap** `{ code, message, data: { user|admin, token } }`.
- `token` tetap access token.
- Response menambahkan header `Set-Cookie` berisi refresh token.
- Tidak ada field refresh token di body.

Contoh response login user (body tidak berubah):

```json
{
  "code": 200,
  "message": "Login berhasil",
  "data": {
    "user": { "id": 1, "name": "Budi", "email": "budi@example.com", "role": "user" },
    "token": "<access-token>"
  }
}
```

### 7.4 Refresh

Request tanpa body; cookie wajib ada.

```http
POST /api/auth/refresh
Origin: https://fastshop-id.vercel.app
Cookie: fastshop_user_refresh=<token>
```

Success `200`:

```json
{
  "code": 200,
  "message": "Token berhasil diperbarui",
  "data": { "token": "<access-token-baru>" }
}
```

Response juga menetapkan cookie refresh baru (rotasi).

Error:

- `401` cookie tidak ada, token tidak dikenal, kedaluwarsa, sudah dicabut,
  portal salah, role berubah, atau `token_version` tidak cocok.
- `403` origin tidak diizinkan.
- `429` melebihi rate limit refresh.

Jika token yang sudah dicabut dipakai lagi, seluruh family dicabut dan response
tetap `401` generik. Detail tidak dibocorkan ke client; event dicatat ke log
server tanpa token mentah.

### 7.5 Logout

Request tanpa body; cookie opsional (idempoten).

```http
POST /api/auth/logout
Origin: https://fastshop-id.vercel.app
Cookie: fastshop_user_refresh=<token>
```

Success `200`:

```json
{ "code": 200, "message": "Logout berhasil" }
```

Cookie selalu dihapus. Jika token ditemukan, seluruh family sesi tersebut
dicabut. Jika cookie tidak ada/tidak dikenal, response tetap `200`.

Error: `403` origin tidak diizinkan.

### 7.6 Ganti password

Request user:

```json
{
  "current_password": "PasswordLama123!",
  "new_password": "PasswordBaru123!"
}
```

Aturan:

- `current_password` wajib dan harus cocok.
- `new_password` mengikuti aturan registrasi: minimal 8 karakter, maksimal 72
  byte, mengandung huruf dan angka.
- `new_password` tidak boleh sama dengan password saat ini.
- Sukses: password diganti, `token_version` naik, semua refresh token user
  dicabut, cookie saat ini dihapus.
- Client harus login ulang setelah sukses.

Success `200`:

```json
{
  "code": 200,
  "message": "Password berhasil diubah. Silakan login ulang."
}
```

Error:

- `400` validasi body atau password saat ini salah.
- `401` access token tidak valid/kedaluwarsa.
- `403` role/type tidak sesuai.
- `429` melebihi rate limit ganti password.

Admin memakai endpoint dan schema yang sama di bawah
`/api/admin/auth/password`.

### 7.7 Origin dan CSRF

Endpoint yang mengandalkan cookie (`refresh` dan `logout`) wajib memiliki header
`Origin` yang termasuk allowlist CORS saat ini. Jika tidak ada atau tidak cocok,
response `403`.

Alasan: produksi memakai `SameSite=None` agar cookie terkirim lintas site.
Tanpa pengecekan origin, endpoint cookie dapat dipicu oleh situs lain (CSRF).
Allowlist tetap satu sumber dengan konfigurasi CORS, diekstrak ke
`src/config/origins.js`.

Endpoint `password` memakai Bearer token, sehingga tidak membutuhkan proteksi
CSRF cookie.

## 8. Alur

### 8.1 Login

1. Verifikasi kredensial dan role seperti sekarang.
2. Baca `users.token_version`.
3. Terbitkan access token dengan klaim `tokenVersion`.
4. Buat refresh token acak, hash, dan insert baris baru dengan `family_id`
   baru, `portal`, dan `token_version` saat ini.
5. Set cookie refresh.
6. Kembalikan response body yang sudah ada.

### 8.2 Refresh (rotasi)

Dalam satu transaksi:

1. Hash token dari cookie, cari baris dengan `token_hash` dan `portal`,
   kunci baris (`FOR UPDATE`), join `users` untuk `role` dan `token_version`.
2. Jika tidak ditemukan: `401`.
3. Jika `revoked_at` sudah terisi: cabut seluruh family, commit, `401`
   (replay terdeteksi).
4. Jika `expires_at <= now()`: `401`.
5. Jika role tidak sesuai portal atau `refresh_tokens.token_version` berbeda
   dengan `users.token_version`: cabut family, commit, `401`.
6. Tandai baris lama `revoked_at = now()`.
7. Buat token baru, insert baris baru dengan family yang sama dan versi user
   saat ini, lalu isi `replaced_by_id`.
8. Commit, set cookie baru, kembalikan access token baru dengan
   `tokenVersion` saat ini.

Client harus mengirim satu request refresh pada satu waktu. Dua request
paralel dengan token lama dapat memicu deteksi replay dan mencabut family;
perilaku ini disengaja (strict rotation).

### 8.3 Logout

1. Baca cookie.
2. Jika ada, cari token dan cabut seluruh family (`revoked_at = now()` untuk
   semua baris aktif di family tersebut).
3. Hapus cookie.
4. Kembalikan `200` idempoten.

Logout tidak menaikkan `token_version`; access token yang sudah terbit tetap
berlaku sampai TTL pendeknya habis (15/30 menit). Ini disengaja agar logout dari
satu perangkat tidak mengeluarkan semua perangkat. Revocation global terjadi
lewat ganti password. Jika suatu saat dibutuhkan revocation access token per
sesi, diperlukan klaim session id dan pengecekan family aktif di luar scope ini.

### 8.4 Ganti password

1. Middleware memverifikasi access token dan `token_version`.
2. Ambil user beserta hash password.
3. Bandingkan `current_password`; jika salah `400`.
4. Tolak `new_password` yang sama dengan password lama.
5. Hash password baru.
6. Dalam transaksi: update `users.password`, naikkan `token_version`,
   `updated_at = now()`, lalu cabut semua refresh token user.
7. Hapus cookie.
8. Kembalikan `200`.

Access token yang masih dipegang client menjadi tidak valid pada request
berikutnya karena klaim `tokenVersion` sudah berbeda.

### 8.5 Update password admin lewat CLI

`scripts/lib/admin.js` (`createOrUpdateAdmin` dengan `--update`, dipakai
`seed:admin` dan `create:admin`) diubah agar dalam satu statement/transaksi:

- update password dan `token_version = token_version + 1`,
- hapus semua baris `refresh_tokens` milik admin tersebut.

Dengan begitu jalur CLI tidak meninggalkan sesi lama yang masih valid.

### 8.6 Middleware access token

`verifyUserToken` dan `verifyAdminToken`:

1. Verifikasi signature dan `exp` seperti sekarang.
2. Cek klaim `role`/`type` seperti sekarang (`403` untuk ketidaksesuaian).
3. Jika klaim `tokenVersion` ada, query `SELECT role, token_version FROM users
   WHERE id = $1`.
4. Tolak `401` jika user tidak ada, role berubah, atau versi tidak cocok.
5. Error database diteruskan ke error handler (`500`), bukan disamarkan menjadi
   `401`.

`verifyAuthToken` dan `authorize` tidak dipakai dan tidak diubah; P2-07 akan
menanganinya.

## 9. Keamanan

- **Penyimpanan:** hanya SHA-256 dari token acak 256-bit. Kebocoran database
  tidak langsung memberi token yang dapat dipakai.
- **Rotasi:** refresh token lama langsung dicabut setelah dipakai.
- **Replay:** pemakaian token yang sudah dicabut mencabut seluruh family.
- **Revocation:** logout mencabut satu sesi; ganti password mencabut semua
  sesi dan menaikkan `token_version`.
- **Access token:** TTL pendek + pengecekan versi per request. Password change
  membatalkan access token seketika.
- **Cookie:** `HttpOnly` mencegah pembacaan JavaScript; `Secure` di produksi;
  `SameSite=None` hanya karena frontend dan API berbeda site, dikompensasi
  dengan allowlist `Origin`.
- **CSRF:** endpoint cookie menolak origin yang tidak dikenal. Body JSON pada
  login juga memaksa preflight CORS untuk origin asing.
- **Brute force:** refresh limiter per IP; ganti password limiter per user.
- **Logging:** token mentah, hash, dan isi cookie tidak boleh masuk log.
  Replay dicatat sebagai event keamanan dengan `userId`/`familyId` saja.
- **Database:** semua query parameterized; tidak ada string SQL dari input.

## 10. Rate Limit

Tambahan di `src/middlewares/rateLimit.js`:

| Limiter | Default | Key |
| :--- | :--- | :--- |
| `refreshLimiter` | 60 / 15 menit | IP |
| `passwordLimiter` | 10 / jam | `user:<id>` |

Env opsional:

- `RATE_LIMIT_REFRESH_WINDOW_MS` (default `900000`)
- `RATE_LIMIT_REFRESH_MAX` (default `60`)
- `RATE_LIMIT_PASSWORD_WINDOW_MS` (default `3600000`)
- `RATE_LIMIT_PASSWORD_MAX` (default `10`)

## 11. Kompatibilitas dan Rollout

### Token lama

Access token yang diterbitkan sebelum deploy tidak memiliki klaim
`tokenVersion`. Middleware menerimanya sampai `exp` habis; setelah itu semua
token baru wajib memiliki klaim. Ini menghindari logout massal saat deploy,
tetapi berarti token lama tidak ikut tercabut oleh ganti password sampai
kedaluwarsa. Dengan default TTL baru (`15m`/`30m`) jendela ini pendek; nilai
`JWT_EXPIRES_IN`/`ADMIN_JWT_EXPIRES_IN` yang sudah ada di environment tetap
berlaku sampai diubah.

Alternatif yang ditolak: menolak semua token tanpa klaim. Alternatif ini lebih
ketat tetapi memaksa semua pengguna login ulang dan memecahkan test non-DB yang
memakai token sintetis.

### Urutan deploy

1. Jalankan migrasi (`npm run migrate:up`) di production.
2. Deploy kode baru.
3. Perbarui environment production bila ingin TTL baru dan cookie settings
   eksplisit.
4. Client frontend harus mengirim `credentials: "include"` dan memanggil
   `/refresh` saat access token kedaluwarsa.

Kode baru membutuhkan kolom dan tabel dari migrasi; menjalankan kode sebelum
migrasi akan membuat login gagal.

### Perubahan perilaku yang perlu diketahui client

- Login sekarang menetapkan cookie; response body tidak berubah.
- Access token user default menjadi 15 menit dan admin 30 menit (bila env tidak
  menimpa).
- Refresh token tidak pernah ada di body.
- Logout dan refresh membutuhkan header `Origin` yang diizinkan.
- Ganti password memaksa login ulang di semua perangkat.

## 12. Testing

### Unit / non-DB

- Opsi cookie: nama, path, `HttpOnly`, `Secure` dan `SameSite` per environment,
  `Max-Age`, penghapusan cookie.
- Parsing cookie dan penolakan cookie yang tidak ada.
- Hash refresh token deterministik dan tidak menyimpan token mentah.
- Middleware origin: origin diizinkan, ditolak, dan tidak ada.
- Middleware versi token dengan token tanpa klaim (legacy) dan dengan klaim.

### DB / API

- Login user/admin menetapkan cookie `HttpOnly`, tidak mengembalikan refresh
  token di body.
- Refresh menghasilkan access token baru dan cookie baru; token lama ditolak.
- Replay token lama mencabut family; token terbaru ikut ditolak.
- Logout mencabut refresh token dan menghapus cookie; logout kedua tetap `200`.
- Refresh token kedaluwarsa ditolak.
- Access token kedaluwarsa ditolak.
- `token_version` yang dinaikkan langsung membatalkan access token.
- Ganti password: password lama salah `400`; sukses menaikkan versi, mencabut
  semua refresh token, menolak access token lama, menolak login password lama,
  menerima login password baru.
- Admin: alur refresh/logout/ganti password setara.
- Isolasi portal: cookie user tidak berlaku di endpoint admin dan sebaliknya.
- Origin: refresh/logout tanpa origin atau origin asing `403`.
- CLI `createOrUpdateAdmin --update` menaikkan `token_version` dan menghapus
  refresh token.
- Migrasi dari database kosong: 9 migrasi, tabel `refresh_tokens`, kolom
  `token_version`, index dan constraint.
- OpenAPI: 44 operasi, exact-set route, security scheme cookie, response
  `401`/`403`, dan `Set-Cookie` pada login/refresh/logout. Test yang mewajibkan
  semua operasi `/api/admin` memakai `adminBearer` diperbarui untuk mengecualikan
  operasi refresh/logout berbasis cookie.

### Verifikasi akhir

```bash
npm test
npm run test:db
npm run test:coverage
npm run lint
npm run docs:validate
npm audit --omit=dev
git diff --check
```

## 13. File yang Akan Berubah

Baru:

- `migrations/<timestamp>_add-refresh-tokens-and-token-version.js`
- `src/services/authTokenService.js`
- `src/utils/refreshCookie.js`
- `src/middlewares/requireTrustedOrigin.js`
- `src/config/origins.js`
- `tests/auth/refresh-token.test.js`
- `tests/auth/refresh-cookie.test.js`
- `tests/auth/origin-guard.test.js`
- design/plan terkait

Diubah:

- `src/services/authService.js`
- `src/services/adminAuthService.js`
- `src/controllers/authController.js`
- `src/controllers/adminAuthController.js`
- `src/routes/authRoutes.js`
- `src/routes/adminAuthRoutes.js`
- `src/validation/authSchemas.js`
- `src/middlewares/authMiddleware.js`
- `src/middlewares/rateLimit.js`
- `src/app.js` (pakai `src/config/origins.js`)
- `src/constants/auth.js`
- `scripts/lib/admin.js`
- `tests/helpers/api.js`
- `tests/admin.test.js`
- `tests/db/migration.test.js`
- `tests/db/schema.test.js`
- `tests/docs/openapi.test.js`
- `docs/openapi.yaml`
- `README.md`
- `.env.example`
- `docs/to-do/todo-perbaikan.md`
- `docs/analisa/analisis-project.md`
- `package.json`, `package-lock.json` (`cookie` direct dependency)

## 14. Risiko dan Mitigasi

| Risiko | Mitigasi |
| :--- | :--- |
| Query DB tambahan per request | Index PK, satu kolom; optimasi cache ditunda sampai ada bukti beban |
| Cookie tidak terkirim lintas site | `SameSite=None; Secure` di produksi; dokumentasi `credentials: include`; uji manual setelah deploy |
| CSRF pada endpoint cookie | Allowlist `Origin` + CORS credentials terbatas |
| Race dua refresh paralel | Rotasi strict + row lock; client harus serialisasi refresh |
| Replay token mencabut sesi baru | Perilaku standar deteksi pencurian; user login ulang |
| Migrasi belum jalan saat kode deploy | Urutan deploy: migrasi dulu, baru kode |
| Token lama tanpa versi | Diterima sampai `exp`; default TTL baru pendek |
| CLI update lupa revoke | Query CLI diperbarui dan diuji |
| Cookie Secure gagal di localhost | Default non-produksi `Secure=false`, `SameSite=Lax` |

## 15. Definition of Done

- [ ] Migrasi `refresh_tokens` + `users.token_version` tersedia dan reversible.
- [ ] Login user/admin menerbitkan access token ber-`tokenVersion` dan cookie
      refresh `HttpOnly`.
- [ ] Refresh merotasi token, mendeteksi replay, dan menolak token
      kedaluwarsa/dicabut.
- [ ] Logout mencabut family refresh token dan menghapus cookie.
- [ ] Ganti password user/admin mencabut semua sesi dan menaikkan versi.
- [ ] CLI admin update ikut mencabut sesi.
- [ ] Middleware menolak access token dengan versi tidak cocok.
- [ ] Endpoint cookie menolak origin yang tidak diizinkan.
- [ ] Test expiry, revocation, replay, isolasi portal, dan CLI lulus.
- [ ] OpenAPI 44 operasi, docs test, README, dan `.env.example` diperbarui.
- [ ] `npm test`, `npm run test:db`, coverage, lint, docs:validate, audit, dan
      `git diff --check` hijau.
- [ ] Tidak ada token/secret yang masuk repository atau log.
