const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const express = require("express");

const requireTrustedOrigin = require("../../src/middlewares/requireTrustedOrigin");

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.post("/cookie", requireTrustedOrigin, (req, res) => {
    res.status(200).json({ ok: true });
  });

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server) return;

  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

const postCookie = (origin) =>
  fetch(`${baseUrl}/cookie`, {
    method: "POST",
    headers: origin === undefined ? {} : { Origin: origin },
  });

test("origin yang diizinkan diterima", async () => {
  const response = await postCookie("http://localhost:5173");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("request tanpa Origin ditolak 403", async () => {
  const response = await postCookie();

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, 403);
  assert.match(body.message, /origin/i);
});

test("origin asing ditolak 403", async () => {
  const response = await postCookie("https://evil.example");

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, 403);
});
