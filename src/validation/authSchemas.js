const { z, requiredString } = require("./common");

const REGISTER_REQUIRED = "Nama, email, dan password wajib diisi.";
const LOGIN_REQUIRED = "Email dan password wajib diisi.";

const registerBody = z.object({
  name: requiredString(REGISTER_REQUIRED)
    .trim()
    .min(1, REGISTER_REQUIRED)
    .max(100, "Nama maksimal 100 karakter."),
  email: requiredString(REGISTER_REQUIRED)
    .email("Format email tidak valid.")
    .max(150, "Email maksimal 150 karakter."),
  password: requiredString(REGISTER_REQUIRED).min(
    6,
    "Password minimal 6 karakter.",
  ),
});

const loginBody = z.object({
  email: requiredString(LOGIN_REQUIRED).email("Format email tidak valid."),
  password: requiredString(LOGIN_REQUIRED),
});

module.exports = {
  registerBody,
  loginBody,
};
