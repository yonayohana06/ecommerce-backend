const REQUIRED_ENV = Object.freeze([
  "JWT_SECRET",
  "ADMIN_JWT_SECRET",
  "PAYMENT_SERVER_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

const DATABASE_ENV = Object.freeze(["DB_HOST", "DB_NAME", "DB_USER"]);

const isSet = (value) => typeof value === "string" && value.trim() !== "";

const validateEnv = (env = process.env, { requireDatabase = true } = {}) => {
  const missing = REQUIRED_ENV.filter((name) => !isSet(env[name]));

  if (requireDatabase) {
    const hasDatabaseUrl = isSet(env.DATABASE_URL);
    const hasDatabaseParts = DATABASE_ENV.every((name) => isSet(env[name]));

    if (!hasDatabaseUrl && !hasDatabaseParts) {
      missing.push("DATABASE_URL atau DB_HOST/DB_NAME/DB_USER");
    }
  }

  if (missing.length > 0) {
    const error = new Error(
      `Environment variable wajib belum diset: ${missing.join(", ")}`,
    );
    error.code = "ENV_MISSING";
    throw error;
  }

  if (env.JWT_SECRET === env.ADMIN_JWT_SECRET) {
    const error = new Error(
      "JWT_SECRET dan ADMIN_JWT_SECRET harus berbeda agar token user dan admin tidak saling tertukar.",
    );
    error.code = "ENV_INVALID";
    throw error;
  }

  return true;
};

module.exports = {
  REQUIRED_ENV,
  validateEnv,
};
