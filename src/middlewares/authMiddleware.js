const jwt = require("jsonwebtoken");

// Verifikasi token autentikasi umum (mendukung token user maupun admin)
const verifyAuthToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      code: 401,
      message: "Akses ditolak: Token autentikasi tidak ditemukan.",
    });
  }

  const token = authHeader.split(" ")[1];
  const adminSecret = process.env.ADMIN_JWT_SECRET;

  try {
    let decoded;
    // Coba verifikasi dengan JWT_SECRET terlebih dahulu
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (userErr) {
      // Jika gagal dan ADMIN_JWT_SECRET diset berbeda, coba verifikasi dengan ADMIN_JWT_SECRET
      if (adminSecret && adminSecret !== process.env.JWT_SECRET) {
        decoded = jwt.verify(token, adminSecret);
      } else {
        throw userErr;
      }
    }

    req.user = decoded; // { userId, email, role, ... }
    next();
  } catch (error) {
    return res.status(401).json({
      code: 401,
      message: "Token tidak valid atau sudah kedaluwarsa.",
    });
  }
};

// Middleware KHUSUS Admin: Memvalidasi token admin & memastikan role === 'admin'
const verifyAdminToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      code: 401,
      message: "Akses ditolak: Token autentikasi admin tidak ditemukan.",
    });
  }

  const token = authHeader.split(" ")[1];
  const adminSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;

  try {
    const decoded = jwt.verify(token, adminSecret);

    if (decoded.role !== "admin") {
      return res.status(403).json({
        code: 403,
        message:
          "Akses dilarang: Akun Anda tidak memiliki hak akses administrator.",
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      code: 401,
      message: "Token admin tidak valid atau sudah kedaluwarsa.",
    });
  }
};

// Middleware KHUSUS User: Memvalidasi token user & menolak jika akun bertipe admin
const verifyUserToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      code: 401,
      message: "Akses ditolak: Token autentikasi tidak ditemukan.",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role === "admin") {
      return res.status(403).json({
        code: 403,
        message:
          "Akses ditolak: Akun administrator tidak diperbolehkan mengakses fitur ini.",
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      code: 401,
      message: "Token tidak valid atau sudah kedaluwarsa.",
    });
  }
};

// Middleware Otorisasi Role (RBAC)
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        code: 403,
        message:
          "Akses dilarang. Anda tidak memiliki izin untuk mengakses resource ini.",
      });
    }
    return next();
  };
};

module.exports = {
  verifyAuthToken,
  verifyAdminToken,
  verifyUserToken,
  authorize,
};
