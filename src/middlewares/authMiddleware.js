const jwt = require("jsonwebtoken");
const db = require("../config/db");

// Token lama tanpa klaim tokenVersion tetap diterima sampai kedaluwarsa.
// Selain itu, role dan versi token harus cocok dengan kondisi user saat ini.
const isTokenVersionValid = async (decoded) => {
  if (decoded.tokenVersion === undefined) {
    return true;
  }

  const result = await db.query(
    "SELECT role, token_version FROM users WHERE id = $1",
    [decoded.userId],
  );
  const user = result.rows[0];

  return Boolean(
    user &&
      user.role === decoded.role &&
      user.token_version === decoded.tokenVersion,
  );
};

// Middleware KHUSUS Admin: Memvalidasi token admin & memastikan role === 'admin'
const verifyAdminToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      code: 401,
      message: "Akses ditolak: Token autentikasi admin tidak ditemukan.",
    });
  }

  const token = authHeader.split(" ")[1];
  const adminSecret = process.env.ADMIN_JWT_SECRET;
  let decoded;

  try {
    decoded = jwt.verify(token, adminSecret);
  } catch (error) {
    return res.status(401).json({
      code: 401,
      message: "Token admin tidak valid atau sudah kedaluwarsa.",
    });
  }

  if (decoded.role !== "admin" || decoded.type !== "admin") {
    return res.status(403).json({
      code: 403,
      message:
        "Akses dilarang: Akun Anda tidak memiliki hak akses administrator.",
    });
  }

  try {
    if (!(await isTokenVersionValid(decoded))) {
      return res.status(401).json({
        code: 401,
        message: "Token admin tidak valid atau sudah kedaluwarsa.",
      });
    }
  } catch (error) {
    return next(error);
  }

  req.user = decoded; // { userId, email, role, type }
  return next();
};

// Middleware KHUSUS User: Memvalidasi token user & menolak jika akun bertipe admin
const verifyUserToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      code: 401,
      message: "Akses ditolak: Token autentikasi tidak ditemukan.",
    });
  }

  const token = authHeader.split(" ")[1];
  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({
      code: 401,
      message: "Token tidak valid atau sudah kedaluwarsa.",
    });
  }

  if (decoded.role === "admin") {
    return res.status(403).json({
      code: 403,
      message:
        "Akses ditolak: Akun administrator tidak diperbolehkan mengakses fitur ini.",
    });
  }

  if (decoded.role !== "user" || decoded.type !== "user") {
    return res.status(403).json({
      code: 403,
      message: "Akses ditolak: token pengguna tidak valid.",
    });
  }

  try {
    if (!(await isTokenVersionValid(decoded))) {
      return res.status(401).json({
        code: 401,
        message: "Token tidak valid atau sudah kedaluwarsa.",
      });
    }
  } catch (error) {
    return next(error);
  }

  req.user = decoded;
  return next();
};

module.exports = {
  verifyAdminToken,
  verifyUserToken,
};
