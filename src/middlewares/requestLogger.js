const { randomUUID } = require("node:crypto");

const { logger: defaultLogger } = require("../utils/logger");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const isRequestIdValid = (value) =>
  typeof value === "string" && REQUEST_ID_PATTERN.test(value);

const createRequestLogger = ({
  logger = defaultLogger,
  generateRequestId = () => randomUUID(),
  now = () => Date.now(),
} = {}) => (req, res, next) => {
  const incoming = typeof req.get === "function" ? req.get("x-request-id") : null;
  const requestId = isRequestIdValid(incoming) ? incoming : generateRequestId();

  req.id = requestId;
  req.log = logger.child({ requestId });

  if (typeof res.setHeader === "function") {
    res.setHeader("X-Request-Id", requestId);
  }

  const startedAt = now();
  let logged = false;

  const writeLog = () => {
    if (logged) {
      return;
    }

    logged = true;

    const status = res.statusCode || 500;
    const fields = {
      msg: "request",
      method: req.method,
      path: req.path || req.originalUrl,
      status,
      durationMs: Math.max(0, now() - startedAt),
    };

    if (req.user && req.user.userId) {
      fields.userId = req.user.userId;
    }

    if (status >= 500) {
      req.log.error(fields);
    } else {
      req.log.info(fields);
    }
  };

  res.on("finish", writeLog);
  res.on("close", () => {
    if (!res.writableEnded) {
      writeLog();
    }
  });

  next();
};

module.exports = {
  createRequestLogger,
  isRequestIdValid,
  REQUEST_ID_PATTERN,
};
