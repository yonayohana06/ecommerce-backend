const { z, requiredString } = require("./common");
const { BCRYPT_MAX_BYTES } = require("../constants/auth");

const REGISTER_REQUIRED = "Nama, email, dan password wajib diisi.";
const LOGIN_REQUIRED = "Email dan password wajib diisi.";

const emailField = (message) =>
  requiredString(message)
    .trim()
    .toLowerCase()
    .max(150, "Email maksimal 150 karakter.")
    .email("Format email tidak valid.");

const registerBody = z.object({
  name: requiredString(REGISTER_REQUIRED)
    .trim()
    .min(1, REGISTER_REQUIRED)
    .max(100, "Nama maksimal 100 karakter."),
  email: emailField(REGISTER_REQUIRED),
  password: requiredString(REGISTER_REQUIRED)
    .min(8, "Password minimal 8 karakter.")
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= BCRYPT_MAX_BYTES,
      "Password maksimal 72 byte.",
    )
    .refine(
      (value) => /[A-Za-z]/.test(value) && /\d/.test(value),
      "Password harus mengandung huruf dan angka.",
    ),
});

const loginBody = z.object({
  email: emailField(LOGIN_REQUIRED),
  password: requiredString(LOGIN_REQUIRED),
});

module.exports = {
  registerBody,
  loginBody,
};
