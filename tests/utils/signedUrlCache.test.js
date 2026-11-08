const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createSignedUrlCache } = require("../../src/utils/signedUrlCache");

test("cache menyimpan dan mengembalikan URL yang belum kedaluwarsa", () => {
  const cache = createSignedUrlCache({ ttlMs: 1000 });
  cache.set("proof-a.png", "https://signed/a");

  assert.equal(cache.get("proof-a.png"), "https://signed/a");
  assert.equal(cache.size(), 1);
});

test("cache mengembalikan null setelah TTL habis", async () => {
  const cache = createSignedUrlCache({ ttlMs: 50 });
  cache.set("proof-a.png", "https://signed/a");

  assert.equal(cache.get("proof-a.png"), "https://signed/a");

  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(cache.get("proof-a.png"), null);
  assert.equal(cache.size(), 0);
});

test("cache mengabaikan path kosong atau null", () => {
  const cache = createSignedUrlCache({ ttlMs: 1000 });

  assert.equal(cache.get(""), null);
  assert.equal(cache.get(null), null);
  assert.equal(cache.get(undefined), null);
  assert.equal(cache.size(), 0);
});

test("cache dapat dibersihkan", () => {
  const cache = createSignedUrlCache({ ttlMs: 1000 });
  cache.set("proof-a.png", "https://signed/a");
  cache.set("proof-b.png", "https://signed/b");

  cache.clear();

  assert.equal(cache.get("proof-a.png"), null);
  assert.equal(cache.get("proof-b.png"), null);
  assert.equal(cache.size(), 0);
});
