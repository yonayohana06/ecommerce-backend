const { test } = require("node:test");
const assert = require("node:assert/strict");
const authMiddleware = require("../../src/middlewares/authMiddleware");

test("authMiddleware tidak mengekspor dead code", () => {
  assert.deepEqual(Object.keys(authMiddleware).sort(), [
    "verifyAdminToken",
    "verifyUserToken",
  ]);
});
