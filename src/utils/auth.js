const bcrypt = require("bcryptjs");

const { INVALID_CREDENTIALS_MESSAGE } = require("../constants/auth");

// Hash valid agar login dengan email yang tidak ada tetap menjalankan bcrypt.compare.
// Tujuannya menyamakan waktu respons sehingga email tidak mudah dienumerasi.
const DUMMY_PASSWORD_HASH =
  "$2b$10$0uJZ0xSmpczwsaUMDEh7fO3UYl0wWTfY42igY2omJ3e/juyR9N8GG";

const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();

const invalidCredentialsError = () => {
  const error = new Error(INVALID_CREDENTIALS_MESSAGE);
  error.statusCode = 401;
  return error;
};

const comparePassword = (password, passwordHash) =>
  bcrypt.compare(password, passwordHash || DUMMY_PASSWORD_HASH);

module.exports = {
  normalizeEmail,
  invalidCredentialsError,
  comparePassword,
};
