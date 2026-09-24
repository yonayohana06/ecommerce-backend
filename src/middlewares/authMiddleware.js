const jwt = require("jsonwebtoken");

const verifyAuthToken = (req, res, next) => {
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
    req.user = decoded; // Menyimpan { userId, email, iat, exp } ke objek request
    next();
  } catch (error) {
    return res.status(401).json({
      code: 401,
      message: "Token tidak valid atau sudah kedaluwarsa.",
    });
  }
};

// Middleware Otorisasi Role (RBAC) - bisa banyak role
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message:
          "Akses dilarang. Anda tidak memiliki izin untuk mengakses resource ini.",
      });
    }
    return next();
  };
};

module.exports = { verifyAuthToken, authorize };
