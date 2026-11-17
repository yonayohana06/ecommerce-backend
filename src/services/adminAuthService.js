const db = require("../config/db");
const {
  normalizeEmail,
  invalidCredentialsError,
  comparePassword,
} = require("../utils/auth");
const {
  createAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshTokenFamily,
} = require("./authTokenService");

const loginAdmin = async ({ email, password }) => {
  const normalizedEmail = normalizeEmail(email);

  // 1. Cari user berdasarkan email yang dinormalisasi
  const userResult = await db.query(
    `SELECT id, name, email, password, role, token_version
     FROM users
     WHERE LOWER(email) = $1;`,
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

  // 4. Buat access token dan refresh token admin
  const token = createAccessToken({ user, portal: "admin" });
  const refresh = await issueRefreshToken({
    userId: user.id,
    portal: "admin",
    tokenVersion: user.token_version,
  });

  return {
    admin: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    token,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
};

const refreshAdminSession = async (refreshToken) => {
  const rotated = await rotateRefreshToken({
    token: refreshToken,
    portal: "admin",
  });

  return {
    accessToken: rotated.accessToken,
    refreshToken: rotated.token,
    refreshExpiresAt: rotated.expiresAt,
  };
};

const logoutAdmin = async (refreshToken) =>
  revokeRefreshTokenFamily({ token: refreshToken, portal: "admin" });

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
  refreshAdminSession,
  logoutAdmin,
  getAdminProfile,
};
