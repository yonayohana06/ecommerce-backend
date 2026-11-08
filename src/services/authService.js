const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const {
  normalizeEmail,
  invalidCredentialsError,
  comparePassword,
} = require("../utils/auth");

const registerUser = async ({ name, email, password }) => {
  const normalizedEmail = normalizeEmail(email);

  // 1. Cek apakah email sudah terdaftar
  const existingUser = await db.query(
    "SELECT id FROM users WHERE LOWER(email) = $1;",
    [normalizedEmail],
  );
  if (existingUser.rows.length > 0) {
    const error = new Error("Email sudah terdaftar. Silakan gunakan email lain.");
    error.statusCode = 400;
    throw error;
  }

  // 2. Hash password menggunakan bcrypt (salt round = 10)
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // 3. Simpan ke database dengan role default 'user'
  const insertQuery = `
    INSERT INTO users (name, email, password, role)
    VALUES ($1, $2, $3, 'user')
    RETURNING id, name, email, role, created_at;
  `;
  const result = await db.query(insertQuery, [
    name,
    normalizedEmail,
    hashedPassword,
  ]);
  return result.rows[0];
};

const loginUser = async ({ email, password }) => {
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

  // 2. Cocokkan password sebelum memeriksa role agar kegagalan tidak bisa dibedakan.
  const isPasswordMatch = await comparePassword(password, user.password);
  if (!isPasswordMatch) {
    throw invalidCredentialsError();
  }

  // 3. Akun admin tidak boleh login melalui portal pelanggan.
  // Respons tetap generik agar role akun tidak dapat dienumerasi.
  if (user.role !== "user") {
    throw invalidCredentialsError();
  }

  // 4. Buat JWT Token Pengguna Biasa
  const tokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    type: "user",
  };

  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    token,
  };
};

const getUserProfile = async (userId) => {
  const result = await db.query(
    "SELECT id, name, email, phone_number, role, created_at FROM users WHERE id = $1 AND role = 'user';",
    [userId],
  );

  if (result.rows.length === 0) {
    const error = new Error("Pengguna tidak ditemukan.");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
};
