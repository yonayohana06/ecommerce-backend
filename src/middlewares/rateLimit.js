const DEFAULT_MESSAGE =
  "Terlalu banyak permintaan. Silakan coba lagi nanti.";

const readPositiveInt = (name, fallback) => {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const createRateLimiter = ({
  windowMs = 15 * 60 * 1000,
  max = 10,
  message = DEFAULT_MESSAGE,
  keyGenerator = (req) => req.ip,
} = {}) => {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();

    if (hits.size > 1000) {
      for (const [key, entry] of hits) {
        if (entry.resetAt <= now) {
          hits.delete(key);
        }
      }
    }

    const key = String(keyGenerator(req) || "unknown");
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader(
      "RateLimit-Remaining",
      String(Math.max(0, max - entry.count)),
    );
    res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      const retryAfter = Math.max(
        1,
        Math.ceil((entry.resetAt - now) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfter));

      return res.status(429).json({
        code: 429,
        message,
      });
    }

    return next();
  };
};

const loginLimiter = createRateLimiter({
  windowMs: readPositiveInt("RATE_LIMIT_LOGIN_WINDOW_MS", 15 * 60 * 1000),
  max: readPositiveInt("RATE_LIMIT_LOGIN_MAX", 10),
});

const registerLimiter = createRateLimiter({
  windowMs: readPositiveInt("RATE_LIMIT_REGISTER_WINDOW_MS", 60 * 60 * 1000),
  max: readPositiveInt("RATE_LIMIT_REGISTER_MAX", 10),
});

const webhookLimiter = createRateLimiter({
  windowMs: readPositiveInt("RATE_LIMIT_WEBHOOK_WINDOW_MS", 60 * 1000),
  max: readPositiveInt("RATE_LIMIT_WEBHOOK_MAX", 60),
});

const uploadLimiter = createRateLimiter({
  windowMs: readPositiveInt("RATE_LIMIT_UPLOAD_WINDOW_MS", 60 * 60 * 1000),
  max: readPositiveInt("RATE_LIMIT_UPLOAD_MAX", 20),
  keyGenerator: (req) =>
    req.user && req.user.userId ? `user:${req.user.userId}` : req.ip,
});

module.exports = {
  DEFAULT_MESSAGE,
  createRateLimiter,
  loginLimiter,
  registerLimiter,
  webhookLimiter,
  uploadLimiter,
};
