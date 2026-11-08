const multer = require("multer");

const { HttpError } = require("../utils/httpError");

const PG_ERRORS = {
  "22P02": [400, "Input tidak valid."],
  "22001": [400, "Input tidak valid."],
  "22003": [400, "Input tidak valid."],
  "23505": [409, "Data sudah terdaftar."],
  "23503": [400, "Data referensi tidak ditemukan."],
  "23514": [400, "Data tidak memenuhi aturan validasi."],
};

const errorHandler = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  let statusCode = 500;
  let message = "Terjadi kesalahan pada server.";

  if (error instanceof HttpError) {
    statusCode = error.statusCode;
    message = error.message;
  } else if (error && error.type === "entity.parse.failed") {
    statusCode = 400;
    message = "Format JSON tidak valid.";
  } else if (error && error.type === "entity.too.large") {
    statusCode = 413;
    message = "Ukuran payload terlalu besar.";
  } else if (error instanceof multer.MulterError) {
    statusCode = 400;

    if (error.code === "LIMIT_FILE_SIZE") {
      message = "Ukuran file terlalu besar. Maksimal 2MB.";
    } else {
      message = "File yang diunggah tidak valid.";
    }
  } else if (error && PG_ERRORS[error.code]) {
    [statusCode, message] = PG_ERRORS[error.code];
  } else if (
    error &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    statusCode = error.statusCode;
    message = error.message || "Permintaan tidak valid.";
  } else {
    console.error("Unhandled error:", error);
  }

  return res.status(statusCode).json({
    code: statusCode,
    message,
  });
};

module.exports = errorHandler;
