const LEVELS = Object.freeze({
  info: 30,
  warn: 40,
  error: 50,
  silent: Number.POSITIVE_INFINITY,
});

const createLogger = ({
  stdout = process.stdout,
  stderr = process.stderr,
  level = "info",
  base = {},
} = {}) => {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const emit = (levelName, fields = {}) => {
    if (LEVELS[levelName] < threshold) {
      return;
    }

    const entry = {
      time: new Date().toISOString(),
      level: levelName,
      ...base,
      ...fields,
    };

    const line = `${JSON.stringify(entry)}\n`;
    const stream = levelName === "error" ? stderr : stdout;
    stream.write(line);
  };

  return {
    info: (fields) => emit("info", fields),
    warn: (fields) => emit("warn", fields),
    error: (fields) => emit("error", fields),
    child: (fields) =>
      createLogger({
        stdout,
        stderr,
        level,
        base: { ...base, ...fields },
      }),
  };
};

const logger = createLogger({ level: process.env.LOG_LEVEL || "info" });

module.exports = {
  LEVELS,
  createLogger,
  logger,
};
