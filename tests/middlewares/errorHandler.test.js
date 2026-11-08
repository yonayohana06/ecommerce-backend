const { test } = require("node:test");
const assert = require("node:assert/strict");
const multer = require("multer");

const errorHandler = require("../../src/middlewares/errorHandler");
const { HttpError } = require("../../src/utils/httpError");

function runHandler(error, { headersSent = false, req = {} } = {}) {
  const response = {
    headersSent,
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  let nextError = null;

  errorHandler(error, req, response, (err) => {
    nextError = err === undefined ? true : err;
  });

  return { response, nextError };
}

test("HttpError dipakai apa adanya", () => {
  const { response } = runHandler(new HttpError(400, "Input tidak valid"));

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    code: 400,
    message: "Input tidak valid",
  });
});

test("error PostgreSQL 22P02 dipetakan menjadi 400", () => {
  const { response } = runHandler({
    code: "22P02",
    message: 'invalid input syntax for type integer: "NaN"',
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 400);
  assert.doesNotMatch(response.body.message, /invalid input syntax|NaN/i);
});

test("error PostgreSQL 23505 dipetakan menjadi 409", () => {
  const { response } = runHandler({
    code: "23505",
    message: "duplicate key value violates unique constraint",
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, 409);
});

test("error PostgreSQL 23503 dipetakan menjadi 400", () => {
  const { response } = runHandler({
    code: "23503",
    message: "insert or update violates foreign key constraint",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 400);
});

test("error PostgreSQL 23514 dipetakan menjadi 400", () => {
  const { response } = runHandler({
    code: "23514",
    message: "new row violates check constraint",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 400);
});

test("error PostgreSQL 22003 out of range dipetakan menjadi 400", () => {
  const { response } = runHandler({
    code: "22003",
    message: "value \"999999999999999999999999\" is out of range for type integer",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 400);
  assert.doesNotMatch(response.body.message, /out of range/i);
});

test("error tak dikenal menjadi 500 tanpa detail internal", () => {
  const { response } = runHandler(
    new Error('relation "rahasia_internal" does not exist'),
  );

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    code: 500,
    message: "Terjadi kesalahan pada server.",
  });
  assert.doesNotMatch(JSON.stringify(response.body), /rahasia_internal|relation/i);
});

test("error 500 dicatat di server beserta stack dan request ID", () => {
  const logs = [];
  const req = {
    id: "req-error-1",
    method: "GET",
    path: "/api/rahasia",
    log: {
      error(fields) {
        logs.push(fields);
      },
    },
  };

  const { response } = runHandler(new Error("boom internal"), { req });

  assert.equal(response.statusCode, 500);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].msg, "request_error");
  assert.equal(logs[0].requestId, "req-error-1");
  assert.match(logs[0].error.stack, /boom internal/);
  assert.doesNotMatch(JSON.stringify(response.body), /boom internal|stack/i);
});

test("error 4xx tidak dicatat sebagai error server", () => {
  const logs = [];
  const req = {
    id: "req-error-2",
    method: "POST",
    path: "/api/auth/login",
    log: {
      error(fields) {
        logs.push(fields);
      },
    },
  };

  const { response } = runHandler(new HttpError(400, "Input tidak valid"), {
    req,
  });

  assert.equal(response.statusCode, 400);
  assert.equal(logs.length, 0);
});

test("malformed JSON dari express.json menjadi 400 JSON", () => {
  const error = new SyntaxError("Unexpected token b in JSON at position 0");
  error.type = "entity.parse.failed";
  error.status = 400;
  error.body = "{bad json";

  const { response } = runHandler(error);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 400);
  assert.match(response.body.message, /json/i);
});

test("MulterError file terlalu besar menjadi 400", () => {
  const { response } = runHandler(new multer.MulterError("LIMIT_FILE_SIZE"));

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 400);
  assert.match(response.body.message, /terlalu besar/i);
});

test("MulterError tipe file salah menjadi 400", () => {
  const { response } = runHandler(new multer.MulterError("LIMIT_UNEXPECTED_FILE"));

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 400);
  assert.match(response.body.message, /file/i);
});

test("error setelah response terkirim diteruskan ke next", () => {
  const error = new Error("late error");
  const { response, nextError } = runHandler(error, { headersSent: true });

  assert.equal(nextError, error);
  assert.equal(response.statusCode, null);
  assert.equal(response.body, null);
});
