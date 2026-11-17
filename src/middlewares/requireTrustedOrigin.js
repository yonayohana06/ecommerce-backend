const { isAllowedOrigin } = require("../config/origins");

const requireTrustedOrigin = (req, res, next) => {
  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).json({
      code: 403,
      message: "Origin tidak diizinkan.",
    });
  }

  return next();
};

module.exports = requireTrustedOrigin;
