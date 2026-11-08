const { Pool } = require("pg");
require("dotenv").config({ quiet: true });

const DEFAULT_POOL_MAX = 5;
const MAX_POOL_MAX = 20;

const resolvePoolMax = (env = process.env) => {
  const parsed = Number.parseInt(env.DB_POOL_MAX, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_POOL_MAX;
  }

  return Math.min(parsed, MAX_POOL_MAX);
};

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
    };

const pool = new Pool({
  ...poolConfig,
  max: resolvePoolMax(),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Jangan biarkan error pada koneksi idle mematikan proses.
pool.on("error", (error) => {
  console.error("Unexpected error on idle PostgreSQL client:", error.message);
});

module.exports = {
  DEFAULT_POOL_MAX,
  MAX_POOL_MAX,
  resolvePoolMax,
  query: (text, params) => pool.query(text, params),
  pool,
};
