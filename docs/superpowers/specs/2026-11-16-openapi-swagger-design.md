# Desain P2-03: Dokumentasi OpenAPI & Swagger UI

## Konteks & intent

README sudah memuat daftar endpoint, tetapi kontrak request/response, aturan auth,
dan error belum tersedia dalam format yang bisa dibaca tooling. Tim frontend dan
admin internal membutuhkan satu sumber kebenaran yang bisa dipakai untuk eksplorasi
manual, contoh integrasi, dan review perubahan API.

Dokumentasi ini tidak mengubah perilaku API. Fokusnya adalah kontrak HTTP yang
akurat, cara menyajikannya dengan aman, dan pencegahan drift di CI.

## Ukuran pekerjaan

Perubahan kecil: dokumentasi + tooling non-produksi, tanpa perubahan skema DB,
endpoint, atau perilaku runtime. Karena itu desain ini ditulis singkat dan tidak
memerlukan builder check terpisah.

## Tujuan

- Menyediakan `docs/openapi.yaml` sebagai sumber kebenaran kontrak API.
- Mendokumentasikan seluruh endpoint, auth, request, response sukses, dan error.
- Menyajikan Swagger UI hanya di non-production.
- Memvalidasi spec dan menyinkronkannya dengan route Express di CI.
- Memberikan contoh penggunaan yang aman di README.

## Non-tujuan

- Tidak mengubah endpoint, validasi, status code, atau format response yang sudah ada.
- Tidak membuat generated API client.
- Tidak melakukan contract test runtime terhadap setiap response.
- Tidak mengekspos Swagger UI di production.
- Tidak menggantikan migrasi TypeScript (P2-04).

## Anti-goals

- Dokumentasi yang diam-diam drift dari kode.
- Menambah dependency produksi yang memperbesar attack surface/audit.
- Membocorkan contoh token, service key, atau data pelanggan nyata.
- Menjadikan dokumentasi sebagai alasan untuk melonggarkan auth di production.

## Batasan

- Runtime: Express 5, CommonJS, Node 24.
- Belum ada dependency YAML/Swagger/validator di project.
- `helmet` global memasang CSP yang memblokir inline script; route docs perlu CSP sendiri.
- UI hanya boleh aktif saat `NODE_ENV !== "production"`.
- `npm audit --omit=dev` wajib tetap 0 critical/high.
- CI menjalankan `npm ci`, `npm run lint`, `npm test`, dan `npm run test:coverage`.
- Semua harga di JSON adalah `number`; `numeric(12)` scale 0 tetap keputusan final.

## Pendekatan yang dipertimbangkan

1. **YAML manual di `docs/` (dipilih).**
   Satu file OpenAPI ditulis tangan, disajikan oleh Swagger UI non-produksi, dan
   divalidasi di CI. Trade-off: sinkronisasi manual, tetapi kontrak mudah di-review,
   tidak terikat kode, dan tidak menambah dependency runtime produksi.
2. **Code-first dengan anotasi JSDoc (`swagger-jsdoc`).**
   Spec di-generate dari anotasi route/controller. Trade-off: dekat dengan kode,
   tetapi anotasi tersebar, sulit di-review sebagai kontrak, dan menambah tooling
   yang menyentuh jalur runtime.
3. **Spec saja tanpa Swagger UI.**
   Hanya file YAML yang dibuka lewat editor/Redoc. Trade-off: risiko produksi paling
   kecil, tetapi tidak ada UI interaktif untuk tim frontend/admin.

Pilihan 1 diambil karena memberi kontrol penuh atas isi kontrak, hasil review berupa
satu file yang jelas, dan semua tooling dapat diletakkan di `devDependencies`.

## Keputusan desain

### Format dan cakupan spec

- OpenAPI **3.0.3** untuk kompatibilitas tooling frontend yang luas.
- Server lokal `http://localhost:3001`; seluruh path ditulis lengkap (`/api/...`,
  `/health`, `/ready`, `/200`) agar mudah dicoba dari Swagger UI.
- 38 operasi: 35 endpoint API + 3 endpoint health.
- Tag: `System`, `Auth`, `Admin Auth`, `Products`, `Categories`, `Cart`, `Orders`,
  `Admin Products`, `Admin Categories`, `Admin Orders`, `Admin Audit Logs`.
- Setiap operasi memiliki `operationId` unik, `summary`, `tags`, parameter/body,
  response sukses, dan response error yang relevan.
- Skema auth: `userBearer` (JWT user) dan `adminBearer` (JWT admin), keduanya
  HTTP bearer. Webhook tidak memakai bearer; signature dijelaskan di body.
- Komponen umum: `Pagination`, `ErrorResponse`, `User`, `Product`, `Category`,
  `CartItem`, `Order`, `OrderItem`, `OrderSummary`, `AuditLog`, dan response
  pembungkus `{ code, message, data }`.
- Error yang didokumentasikan: 400, 401, 403, 404, 409, 429, 500, dan 503 untuk
  readiness. Error upload memakai 400 (termasuk file terlalu besar/invalid).
- Contoh memakai data placeholder; tidak ada token, email, atau key nyata.

### Penyajian Swagger UI

- Modul baru `src/docs/apiDocs.js` mengekspor pemeriksa `isApiDocsEnabled()` dan
  factory router docs.
- Router hanya dipasang di `src/app.js` bila `NODE_ENV !== "production"`, sebelum
  `notFound`.
- Route:
  - `GET /api/docs` — Swagger UI.
  - `GET /api/docs/openapi.json` — spec terparse untuk tooling.
  - `GET /api/docs/openapi.yaml` — file sumber.
- `yaml` dan `swagger-ui-express` menjadi `devDependencies` dan di-`require` secara
  lazy hanya saat router docs dibuat. Production tidak memuat modul tersebut.
- Route docs menghapus header CSP global lalu memasang CSP khusus yang
  mengizinkan inline script/style yang dibutuhkan Swagger UI, tanpa melonggarkan
  CSP global. Ini perlu karena beberapa header CSP digabung oleh browser, bukan
  saling menimpa.
- Keputusan tambahan: menyediakan `openapi.json` dan `openapi.yaml`; keduanya
  berguna untuk Postman/Insomnia dan debugging tanpa membuka UI.

### Validasi dan pencegahan drift

- `@apidevtools/swagger-parser` menjadi `devDependency`.
- `scripts/validate-openapi.js` memvalidasi spec dan dipanggil lewat
  `npm run docs:validate`.
- `tests/docs/openapi.test.js`:
  - spec valid dan dapat di-resolve;
  - setiap operasi punya `operationId` unik, `summary`, `tags`, dan `responses`;
  - himpunan operasi di spec sama persis dengan operasi yang diekstrak dari
    router Express (termasuk konversi `:param` menjadi `{param}`);
  - health endpoint langsung dari `app.js` dimasukkan manual;
  - route `/api/docs` dikecualikan karena bukan bagian dari kontrak API bisnis.
- `tests/docs/apiDocs.test.js`:
  - `isApiDocsEnabled` false untuk `NODE_ENV=production`, true untuk development/test;
  - server non-production menyajikan UI, JSON, dan YAML;
  - response UI memakai CSP yang mengizinkan inline script.
- CI menambahkan langkah `npm run docs:validate` sebelum lint; `npm test` juga
  menjalankan tes sinkronisasi.

### Dokumentasi penggunaan

- README mendapat bagian “Dokumentasi API (OpenAPI)”:
  - lokasi file sumber;
  - cara membuka Swagger UI lokal;
  - cara validasi spec;
  - catatan bahwa UI tidak tersedia di production;
  - contoh `curl` untuk login user, mengambil katalog, dan request ber-token.
- Checklist P2-03, analisis, dan ledger diperbarui setelah verifikasi.

## Perubahan file

- `docs/openapi.yaml` (baru)
- `docs/superpowers/specs/2026-11-16-openapi-swagger-design.md` (dokumen ini)
- `src/docs/apiDocs.js` (baru)
- `src/app.js`
- `scripts/validate-openapi.js` (baru)
- `tests/docs/openapi.test.js` (baru)
- `tests/docs/apiDocs.test.js` (baru)
- `package.json` dan `package-lock.json`
- `.github/workflows/test.yml`
- `README.md`
- `docs/to-do/todo-perbaikan.md`
- `docs/analisa/analisis-project.md`

## Strategi TDD

1. **RED**
   - Tulis tes validasi/sinkronisasi spec dan tes route docs.
   - Jalankan; keduanya gagal karena file/route belum ada.
2. **GREEN**
   - Tambahkan dependency dev, script validator, modul docs, mount di `app.js`.
   - Tulis `docs/openapi.yaml` sampai seluruh operasi dan skema tervalidasi.
3. **REFACTOR**
   - Rapikan deskripsi, contoh, dan komponen agar tidak duplikatif.
4. **Verifikasi**
   - `npm test`, `npm run test:db`, `npm run test:coverage`, `npm run lint`,
     `npm run docs:validate`, `npm audit --omit=dev`, `git diff --check`.

## Risiko & mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Spec drift dari route | Tes sinkronisasi exact-set terhadap router Express |
| Swagger UI bocor ke production | Guard `NODE_ENV !== "production"` + unit test; route tidak dipasang |
| CSP memblokir UI | CSP khusus route docs; tes header |
| Dependency dev hilang di production | Modul docs di-require lazy dan tidak pernah dipanggil di production |
| Spec terlalu besar | Komponen reusable, tag, dan review per bagian |
| Contoh membocorkan rahasia | Placeholder eksplisit dan larangan token nyata |

## Kriteria penerimaan

- [ ] `docs/openapi.yaml` valid dan mencakup seluruh operasi.
- [ ] Tes sinkronisasi gagal jika route bertambah/berkurang tanpa update spec.
- [ ] Swagger UI, JSON, dan YAML tersedia di non-production dan tidak di production.
- [ ] `npm run docs:validate` tersedia dan dipakai di CI.
- [ ] README memuat cara akses dan contoh penggunaan.
- [ ] Tidak ada dependency produksi baru; audit tetap bersih.
- [ ] Seluruh tes, lint, coverage, dan diff check lulus.

## Yang diserahkan ke builder

- Penulisan deskripsi, contoh, dan schema field per endpoint.
- Pemilihan versi devDependency yang kompatibel.
- Detail direktif CSP untuk route docs.
- Penyesuaian kecil wording README/checklist.
