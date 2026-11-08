const jwt = require("jsonwebtoken");
const db = require("../config/db");
const {
  normalizeEmail,
  invalidCredentialsError,
  comparePassword,
} = require("../utils/auth");

const loginAdmin = async ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email);

  // 1. Cari user berdasarkan email yang dinormalisasi
  const userResult = await db.query(
    "SELECT id, name, email, password, role FROM users WHERE LOWER(email) = $1;",
    [normalizedEmail],
  );

  if (userResult.rows.length === 0) {
    // Tetap jalankan bcrypt agar waktu respons mirip dengan email yang ada.
    await comparePassword(password);
    throw invalidCredentialsError();
  }

  const user = userResult.rows[0];

  // 2. Cocokkan password sebelum memeriksa role.
  const isPasswordMatch = await comparePassword(password, user.password);
  if (!isPasswordMatch) {
    throw invalidCredentialsError();
  }

  // 3. Wajib role 'admin'; kegagalan tetap generik agar role tidak dapat dienumerasi.
  if (user.role !== "admin") {
    throw invalidCredentialsError();
  }

  // 4. Buat JWT Admin Token
  const tokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    type: "admin",
  };

  const adminSecret = process.env.ADMIN_JWT_SECRET;
  const token = jwt.sign(tokenPayload, adminSecret, {
    expiresIn: process.env.ADMIN_JWT_EXPIRES_IN || "8h",
  });

  return {
    admin: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    token,
  };
};

const getAdminProfile = async (adminId) => {
  const result = await db.query(
    "SELECT id, name, email, phone_number, role, created_at FROM users WHERE id = $1 AND role = 'admin';",
    [adminId],
  );

  if (result.rows.length === 0) {
    const error = new Error("Akun administrator tidak ditemukan.");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
};

module.exports = {
  loginAdmin,
  getAdminProfile,
};
