const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const { createLogger } = require("../../src/utils/logger");
const { createRequestLogger } = require("../../src/middlewares/requestLogger");

const createStream = () => {
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(chunk);
      return true;
    },
    entries() {
      return chunks.map((chunk) => JSON.parse(chunk));
    },
  };
};

const createResponse = () => {
  const headers = {};
  const listeners = {};
  return {
    headers,
    statusCode: 200,
    writableEnded: false,
    setHeader(name, value) {
      headers[name] = value;
    },
    on(event, handler) {
      listeners[event] = handler;
    },
    emit(event) {
      if (listeners[event]) {
        listeners[event]();
      }
    },
    hasListener(event) {
      return Boolean(listeners[event]);
    },
  };
};

const createRequest = (headers = {}) => ({
  method: "GET",
  path: "/api/products",
  get(name) {
    return headers[name.toLowerCase()];
  },
});

test("logger menulis JSON terstruktur ke stream", () => {
  const stdout = createStream();
  const logger = createLogger({ stdout, stderr: createStream() });

  logger.info({ msg: "halo", requestId: "abc" });

  const [entry] = stdout.entries();
  assert.equal(entry.level, "info");
  assert.equal(entry.msg, "halo");
  assert.equal(entry.requestId, "abc");
  assert.match(entry.time, /^\d{4}-\d{2}-\d{2}T/);
});

test("logger level error menulis ke stderr", () => {
  const stdout = createStream();
  const stderr = createStream();
  const logger = createLogger({ stdout, stderr });

  logger.error({ msg: "gagal", stack: "stack-trace" });

  assert.equal(stdout.entries().length, 0);
  const [entry] = stderr.entries();
  assert.equal(entry.level, "error");
  assert.equal(entry.stack, "stack-trace");
});

test("logger dapat dibungkus child dengan field tetap", () => {
  const stdout = createStream();
  const logger = createLogger({ stdout, stderr: createStream() });

  logger.child({ requestId: "req-1" }).info({ msg: "tes" });

  const [entry] = stdout.entries();
  assert.equal(entry.requestId, "req-1");
});

test("request logger membuat request ID dan mengirim header", () => {
  const stdout = createStream();
  const logger = createLogger({ stdout, stderr: createStream() });
  const middleware = createRequestLogger({ logger });
  const req = createRequest();
  const res = createResponse();

  middleware(req, res, () => {});

  assert.match(req.id, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers["X-Request-Id"], req.id);
  assert.equal(res.hasListener("finish"), true);
});

test("request logger memakai X-Request-Id yang valid dari client", () => {
  const middleware = createRequestLogger({
    logger: createLogger({ stdout: createStream(), stderr: createStream() }),
  });
  const req = createRequest({ "x-request-id": "client-request-123" });
  const res = createResponse();

  middleware(req, res, () => {});

  assert.equal(req.id, "client-request-123");
  assert.equal(res.headers["X-Request-Id"], "client-request-123");
});

test("request logger menolak X-Request-Id yang tidak valid", () => {
  const middleware = createRequestLogger({
    logger: createLogger({ stdout: createStream(), stderr: createStream() }),
    generateRequestId: () => randomUUID(),
  });
  const req = createRequest({ "x-request-id": "id dengan spasi" });
  const res = createResponse();

  middleware(req, res, () => {});

  assert.notEqual(req.id, "id dengan spasi");
  assert.match(req.id, /^[0-9a-f-]{36}$/);
});

test("request logger mencatat method, path, status, dan durasi", () => {
  const stdout = createStream();
  let currentTime = 1000;
  const middleware = createRequestLogger({
    logger: createLogger({ stdout, stderr: createStream() }),
    now: () => currentTime,
  });
  const req = createRequest();
  const res = createResponse();

  middleware(req, res, () => {});
  res.statusCode = 201;
  currentTime = 1032;
  res.writableEnded = true;
  res.emit("finish");

  const [entry] = stdout.entries();
  assert.equal(entry.msg, "request");
  assert.equal(entry.method, "GET");
  assert.equal(entry.path, "/api/products");
  assert.equal(entry.status, 201);
  assert.equal(entry.durationMs, 32);
  assert.equal(entry.requestId, req.id);
});

test("request logger menandai respons 5xx sebagai error", () => {
  const stderr = createStream();
  const middleware = createRequestLogger({
    logger: createLogger({ stdout: createStream(), stderr }),
  });
  const req = createRequest();
  const res = createResponse();

  middleware(req, res, () => {});
  res.statusCode = 500;
  res.writableEnded = true;
  res.emit("finish");

  const [entry] = stderr.entries();
  assert.equal(entry.level, "error");
  assert.equal(entry.status, 500);
});

test("request logger hanya mencatat sekali", () => {
  const stdout = createStream();
  const middleware = createRequestLogger({
    logger: createLogger({ stdout, stderr: createStream() }),
  });
  const req = createRequest();
  const res = createResponse();

  middleware(req, res, () => {});
  res.writableEnded = true;
  res.emit("finish");
  res.emit("close");

  assert.equal(stdout.entries().length, 1);
});
