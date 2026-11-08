const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_POOL_MAX,
  MAX_POOL_MAX,
  resolvePoolMax,
} = require("../../src/config/db");

test("resolvePoolMax memakai default 5", () => {
  assert.equal(DEFAULT_POOL_MAX, 5);
  assert.equal(resolvePoolMax({}), 5);
});

test("resolvePoolMax membaca DB_POOL_MAX yang valid", () => {
  assert.equal(resolvePoolMax({ DB_POOL_MAX: "8" }), 8);
});

test("resolvePoolMax mengabaikan nilai tidak valid dan membatasi nilai besar", () => {
  assert.equal(resolvePoolMax({ DB_POOL_MAX: "0" }), 5);
  assert.equal(resolvePoolMax({ DB_POOL_MAX: "-3" }), 5);
  assert.equal(resolvePoolMax({ DB_POOL_MAX: "abc" }), 5);
  assert.equal(resolvePoolMax({ DB_POOL_MAX: "1000" }), MAX_POOL_MAX);
});
