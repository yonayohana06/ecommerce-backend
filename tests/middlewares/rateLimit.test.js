const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const express = require("express");

const { createRateLimiter } = require("../../src/middlewares/rateLimit");

test("rate limiter mengembalikan 429 setelah batas tercapai", async () => {
  const app = express();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });

  app.get("/limited", limiter, (req, res) => res.json({ ok: true }));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    const first = await fetch(`http://127.0.0.1:${port}/limited`);
    const second = await fetch(`http://127.0.0.1:${port}/limited`);
    const third = await fetch(`http://127.0.0.1:${port}/limited`);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);

    const body = await third.json();
    assert.equal(body.code, 429);
    assert.match(body.message, /terlalu banyak/i);
    assert.ok(Number(third.headers.get("retry-after")) > 0);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("rate limiter memakai key yang berbeda secara terpisah", async () => {
  const app = express();
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 1,
    keyGenerator: (req) => req.headers["x-test-key"] || req.ip,
  });

  app.get("/limited", limiter, (req, res) => res.json({ ok: true }));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    const request = (key) =>
      fetch(`http://127.0.0.1:${port}/limited`, {
        headers: { "x-test-key": key },
      });

    assert.equal((await request("a")).status, 200);
    assert.equal((await request("b")).status, 200);
    assert.equal((await request("a")).status, 429);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
