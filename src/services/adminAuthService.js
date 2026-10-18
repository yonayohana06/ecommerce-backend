const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const loginAdmin = async ({ email, password }) => {
  // 1. Cari user berdasarkan email
  const userResult = await db.query(
    "SELECT id, name, email, password, role FROM users WHERE email = $1;",
    [email],
  );

  if (userResult.rows.length === 0) {
    const error = new Error("Akun tidak ditemukan");
    error.statusCode = 404;
    throw error;
  }

  const user = userResult.rows[0];

  // 2. Proteksi Pemisahan: Wajib role 'admin'
  if (user.role !== "admin") {
    const error = new Error(
      "Akses ditolak. Akun Anda tidak memiliki hak akses administrator.",
    );
    error.statusCode = 403;
    throw error;
  }

  // 3. Cocokkan raw password dengan hashed password di DB
  const isPasswordMatch = await bcrypt.compare(password, user.password);
  if (!isPasswordMatch) {
    const error = new Error(
      "Kredensial tidak valid (Email atau Password salah).",
    );
    error.statusCode = 401;
    throw error;
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
