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
