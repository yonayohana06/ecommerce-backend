const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveRefreshCookieSettings,
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
} = require("../../src/utils/refreshCookie");

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

  clearRefreshCookie(res, {
    portal: "user",
    env: { NODE_ENV: "production" },
  });

  assert.equal(calls[0][0], "fastshop_user_refresh");
  assert.equal(calls[0][1].path, "/api/auth");
  assert.equal(calls[0][1].secure, true);
  assert.equal(calls[0][1].sameSite, "none");
  assert.equal(Object.hasOwn(calls[0][1], "maxAge"), false);
});

test("COOKIE_SECURE dan COOKIE_SAME_SITE menimpa default environment", () => {
  const settings = resolveRefreshCookieSettings({
    portal: "user",
    env: {
      NODE_ENV: "production",
      COOKIE_SECURE: "false",
      COOKIE_SAME_SITE: "lax",
    },
  });

  assert.equal(settings.secure, false);
  assert.equal(settings.sameSite, "lax");
});
