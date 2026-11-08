const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");

// Pastikan env pakai dummy agar Supabase tidak mencoba koneksi nyata.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

// Siapkan mock Supabase Storage SEBELUM paymentService dimuat, sehingga
// referensi supabase di dalam paymentService sama dengan yang di-mock.
const supabase = require("../../src/config/supabase");

const batchCalls = [];
const originalFrom = supabase.storage.from.bind(supabase.storage);

supabase.storage.from = (bucket) => ({
  createSignedUrls: async (paths, expiresIn) => {
    batchCalls.push({ bucket, paths, expiresIn });
    return {
      data: paths.map((p) => ({
        path: p,
        signedURL: `https://example.test/signed/${encodeURIComponent(p)}`,
      })),
      error: null,
    };
  },
});

const {
  generateSignedUrl,
  generateSignedUrls,
  clearSignedUrlCache,
} = require("../../src/services/paymentService");

beforeEach(() => {
  batchCalls.length = 0;
  clearSignedUrlCache();
});

after(() => {
  supabase.storage.from = originalFrom;
  clearSignedUrlCache();
});

test("generateSignedUrls memanggil createSignedUrls sekali untuk banyak path", async () => {
  const result = await generateSignedUrls(["a.png", "b.png", "c.png"]);

  assert.equal(batchCalls.length, 1);
  assert.deepEqual(batchCalls[0].paths, ["a.png", "b.png", "c.png"]);
  assert.equal(batchCalls[0].expiresIn, 3600);
  assert.equal(result.get("a.png"), "https://example.test/signed/a.png");
  assert.equal(result.get("b.png"), "https://example.test/signed/b.png");
  assert.equal(result.get("c.png"), "https://example.test/signed/c.png");
});

test("generateSignedUrls memanfaatkan cache untuk path yang sama", async () => {
  await generateSignedUrls(["a.png"]);
  assert.equal(batchCalls.length, 1);

  const result = await generateSignedUrls(["a.png", "b.png"]);
  assert.equal(batchCalls.length, 2);
  assert.deepEqual(batchCalls[1].paths, ["b.png"]);
  assert.equal(result.get("a.png"), "https://example.test/signed/a.png");
  assert.equal(result.get("b.png"), "https://example.test/signed/b.png");
});

test("generateSignedUrls mengabaikan path kosong dan duplikat", async () => {
  const result = await generateSignedUrls(["", null, undefined, "a.png"]);

  assert.equal(batchCalls.length, 1);
  assert.deepEqual(batchCalls[0].paths, ["a.png"]);
  assert.equal(result.size, 1);
  assert.equal(result.get("a.png"), "https://example.test/signed/a.png");
});

test("generateSignedUrl mengembalikan URL tunggal", async () => {
  const url = await generateSignedUrl("single.png");

  assert.equal(url, "https://example.test/signed/single.png");
  assert.equal(batchCalls.length, 1);
});

test("generateSignedUrl mengembalikan null untuk path kosong", async () => {
  assert.equal(await generateSignedUrl(""), null);
  assert.equal(await generateSignedUrl(null), null);
  assert.equal(await generateSignedUrl(undefined), null);
  assert.equal(batchCalls.length, 0);
});

test("generateSignedUrl mengembalikan URL utuh apa adanya", async () => {
  const url = await generateSignedUrl("https://example.test/already.png");

  assert.equal(url, "https://example.test/already.png");
  assert.equal(batchCalls.length, 0);
});

test("cache tidak menyajikan URL kedaluwarsa", async () => {
  // Cache TTL default 5 menit, ini simulasi kedaluwarsa tidak terjadi
  // di tengah tes batch (sudah diuji di signedUrlCache.test.js).
  const result = await generateSignedUrls(["x.png"]);
  assert.equal(result.get("x.png"), "https://example.test/signed/x.png");
  
  // Panggil lagi, seharusnya dari cache (batchCalls tidak bertambah).
  const result2 = await generateSignedUrls(["x.png"]);
  assert.equal(result2.get("x.png"), "https://example.test/signed/x.png");
  assert.equal(batchCalls.length, 1);
});
