# Design — P2-05: Optimasi Performa dan Pencarian Admin

**Tanggal:** 20 November 2026
**Status:** menunggu persetujuan
**Scope:** P2-05 di `docs/to-do/todo-perbaikan.md`

## Intent

Pencarian daftar pesanan admin saat ini memakai `CAST(o.id AS TEXT) ILIKE '%input%'`, sehingga
index primary key `orders.id` tidak terpakai. P2-05 juga meminta evaluasi count query, pengukuran
`EXPLAIN ANALYZE` pada data menyerupai production, dan target latency endpoint list.

Perubahan harus menghilangkan pola cast tersebut tanpa mengubah bentuk respons, route, status code,
atau pesan API. Satu-satunya perubahan perilaku yang disengaja adalah arti input angka pada
`search` admin order.

## Goals

- Input `search` yang seluruhnya angka mencari **ID pesanan secara exact** (`o.id = $n::bigint`).
- Input `search` yang bukan angka mencari **email user secara substring** (`u.email ILIKE '%input%'`).
- Tidak ada pencarian silang: angka tidak mencari email, teks tidak mencari ID.
- Memastikan index yang dibutuhkan sudah ada; tidak menambah index tanpa bukti pengukuran.
- Mengukur latency daftar pesanan admin dan daftar produk pada data sintetis 10.000 baris.
- Menetapkan dan memverifikasi target: **p95 < 200 ms** untuk limit 10 dan 100 pada PostgreSQL lokal.
- Mengevaluasi count query produk/order berdasarkan pengukuran, bukan asumsi.
- Memperbarui dokumentasi dan checklist P2-05 dengan hasil aktual.

## Non-goals

- Migrasi TypeScript (P2-04).
- Mengubah count query menjadi cache, estimasi, atau `COUNT(*) OVER()` pada iterasi ini.
- Mengubah pencarian produk, pencarian nama user, atau kontrak respons API.
- Menambah dependency baru.
- Load test production atau tuning konfigurasi PostgreSQL server.
- Menerapkan migration ke database production/local; P2-05 tidak membuat migration baru.

## Constraints

- `numeric(12)` scale 0 tetap dipertahankan.
- Tidak ada perubahan route, status code, pesan respons, atau bentuk JSON.
- Test ditulis sebelum production code (TDD).
- Benchmark harus aman: hanya boleh berjalan pada `TEST_DATABASE_URL`, menolak
  `NODE_ENV=production`, dan menolak jika URL target sama dengan `DATABASE_URL`.
- Seed benchmark memakai prefix unik dan dibersihkan di blok `finally`, sehingga tidak meninggalkan data.
- Verifikasi format tetap memakai `npm run lint` dan `git diff --check`; tanpa formatter baru.

## Current State

- `paymentService.getAllOrdersForAdmin` membangun filter:
  `(CAST(o.id AS TEXT) ILIKE $n OR u.email ILIKE $n)`.
- Index `orders(status, created_at)` sudah dibuat oleh migration
  `1794119284866_add-integrity-constraints.js`; checklist P2-05 masih menandainya belum selesai.
- `orders.id` adalah primary key, sehingga pencarian exact otomatis memakai index PK.
- Count query produk dan admin order masih dijalankan terpisah dengan `COUNT(*)`.
- Database test berukuran kecil; pengukuran representatif memerlukan seed sintetis.

## Approaches

### A. Perbaikan terarah + ukur dulu (dipilih)

Ubah hanya cabang `search`, tambah regression test DB, verifikasi index yang ada, lalu ukur dengan
script benchmark opt-in. Count query tidak diubah kecuali target latency terbukti terlampaui.

- Trade-off: perubahan kecil dan aman; ada satu script benchmark opsional yang perlu dirawat.

### B. Hilangkan count query dengan `COUNT(*) OVER()`

Satu query membawa data dan total. Ditolak karena halaman yang melewati data terakhir tidak
memiliki row untuk membawa total, sehingga tetap butuh fallback count; plan juga dapat lebih mahal
karena menghitung seluruh hasil sebelum `LIMIT`. Manfaatnya belum terbukti sebelum diukur.

### C. Cache total count dengan TTL

Ditolak karena `totalItems` bisa basi setelah checkout atau perubahan status, invalidasi sulit, dan
cache in-memory tidak konsisten untuk multi-instance/Vercel.

## Decisions

### Semantik pencarian admin order

Setelah `trim`:

- `^[0-9]+$` → exact `o.id = $n::bigint`.
- Selain itu → `u.email ILIKE $n` dengan pola `%input%`.
- String angka dengan leading zero tetap diperlakukan sebagai angka; `00057` cocok dengan ID 57.
- Angka di luar jangkauan `bigint` (di atas 9223372036854775807) menghasilkan respons 200 dengan
  data kosong, bukan error database. Ini mempertahankan sifat filter: input tidak valid sebagai ID
  tidak boleh membuat request gagal.
- Status filter tetap dapat digabung dengan kedua jenis pencarian.

### Index

Tidak ada migration baru. Index yang sudah ada diverifikasi:

- primary key `orders.id` untuk exact search;
- `orders(status, created_at)` untuk filter status dan pengurutan;
- index produk yang sudah ada untuk daftar produk.

Jika `EXPLAIN ANALYZE` menunjukkan sequential scan yang tidak wajar, temuan dicatat dan
dibahas terpisah sebelum menambah index.

### Count query

Count query produk/order diukur sebagai bagian dari endpoint list. Keputusan:

- Jika p95 < 200 ms, count query dipertahankan dan hasil pengukuran didokumentasikan.
- Jika p95 ≥ 200 ms, pekerjaan berhenti dan dilaporkan ke pemilik project. Perubahan cache/window
  function memerlukan persetujuan desain baru, bukan dilakukan diam-diam dalam P2-05.

### Benchmark

Script baru `scripts/benchmark-admin-search.js`, opt-in, memakai `pg` yang sudah terpasang:

- Wajib `TEST_DATABASE_URL`; menolak `NODE_ENV=production` dan URL yang sama dengan `DATABASE_URL`.
- Seed 10.000 user, 10.000 order, dan 10.000 produk dengan prefix unik, lalu `COMMIT` agar
  terlihat oleh koneksi pool yang dipakai service.
- Menjalankan `ANALYZE` pada tabel terkait, lalu warm-up dan 30 iterasi per skenario.
- Skenario: admin order tanpa filter, filter status, exact ID, email substring, masing-masing limit
  10 dan 100; daftar produk tanpa filter dan dengan search, limit 10 dan 100.
- Latency diukur di sekitar pemanggilan service (termasuk count, serialisasi, dan query data).
- Output: p50, p95, max per skenario, plus ringkasan `EXPLAIN (ANALYZE, BUFFERS)`.
- Seluruh seed dihapus di blok `finally` berdasarkan prefix unik; script keluar dengan kode non-zero
  jika ada skenario melewati target atau cleanup gagal.

### Dokumentasi

- `docs/openapi.yaml`: deskripsi parameter `AdminOrderSearch` menjelaskan exact ID untuk input angka
  dan substring email untuk input non-angka.
- `README.md` (bila menyebut pencarian admin) diselaraskan.
- `docs/to-do/todo-perbaikan.md`: checklist P2-05 dicentang sesuai bukti, index dicatat sudah ada,
  dan bagian **Progres 20 November 2026** memuat hasil pengukuran aktual.
- `docs/analisa/analisis-project.md`: bullet performa terkait diperbarui.
- Ledger `.superpowers/sdd/...` diperbarui.

## Validation

- Test DB membuktikan:
  - ID penuh mengembalikan pesanan yang tepat;
  - potongan ID atau ID dengan tambahan digit tidak cocok;
  - email substring mengembalikan pesanan user terkait;
  - input angka tidak mencocokkan email;
  - input non-angka tidak mencocokkan ID;
  - angka di luar jangkauan bigint menghasilkan 200 dan data kosong;
  - kombinasi status + search tetap benar.
- `npm test`: 0 fail.
- `npm run test:db`: seluruh test lulus.
- `npm run test:coverage`: ambang 60% lines/branches/functions terpenuhi.
- `npm run lint`: `Lint OK`.
- `npm run docs:validate`: `OpenAPI valid`.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `git diff --check`: bersih.
- Benchmark: semua skenario p95 < 200 ms pada 10.000 baris; jika tidak, dilaporkan sebagai blocker.

## What Is Left to the Builder

- Memilih nama file test dan menyusun data uji yang deterministik.
- Detail SQL seed benchmark dan format output.
- Urutan task TDD dan pemecahan plan.
- Penyesuaian kecil lain yang tidak mengubah keputusan di atas.
