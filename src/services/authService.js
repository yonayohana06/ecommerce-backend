const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const registerUser = async ({ name, email, password }) => {
  // 1. Cek apakah email sudah terdaftar
  const existingUser = await db.query(
    "SELECT id FROM users WHERE email = $1;",
    [email],
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
  const result = await db.query(insertQuery, [name, email, hashedPassword]);
  return result.rows[0];
};

const loginUser = async ({ email, password }) => {
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

  // 2. Proteksi Pemisahan: Cegah admin login di portal pelanggan biasa
  if (user.role === "admin") {
    const error = new Error(
      "Akun administrator tidak dapat login melalui portal pelanggan. Silakan gunakan portal admin.",
    );
    error.statusCode = 403;
    throw error;
  }

  // 3. Cocokkan raw password dengan hashed password di DB
  const isPasswordMatch = await bcrypt.compare(password, user.password);
  if (!isPasswordMatch) {
    const error = new Error("Kredensial tidak valid (Email atau Password salah).");
    error.statusCode = 401;
    throw error;
  }

  // 4. Buat JWT Token Pengguna Biasa
  const tokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    type: "user",
  };

  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
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
