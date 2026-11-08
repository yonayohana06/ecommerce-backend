const { Client } = require("pg");

const getDatabaseName = (connectionString) => {
  const url = new URL(connectionString);
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
};

const buildDatabaseUrl = (connectionString, databaseName) => {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
};

const getMaintenanceUrl = (connectionString) => {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
};

const getSslConfig = (connectionString) => {
  const url = new URL(connectionString);
  return url.searchParams.get("sslmode") === "disable"
    ? false
    : { rejectUnauthorized: false };
};

const quoteIdentifier = (identifier) =>
  `"${String(identifier).replace(/"/g, '""')}"`;

const createMaintenanceClient = (connectionString) =>
  new Client({
    connectionString: getMaintenanceUrl(connectionString),
    ssl: getSslConfig(connectionString),
  });

async function databaseExists(connectionString, databaseName) {
  const client = createMaintenanceClient(connectionString);

  try {
    await client.connect();
    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );
    return result.rowCount > 0;
  } finally {
    await client.end();
  }
}

async function createDatabase(connectionString, databaseName) {
  if (await databaseExists(connectionString, databaseName)) {
    return false;
  }

  const client = createMaintenanceClient(connectionString);

  try {
    await client.connect();
    await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    return true;
  } finally {
    await client.end();
  }
}

async function dropDatabase(connectionString, databaseName) {
  const client = createMaintenanceClient(connectionString);

  try {
    await client.connect();
    await client.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
    );
  } finally {
    await client.end();
  }
}

async function ensureTestDatabase(connectionString) {
  const databaseName = getDatabaseName(connectionString);

  if (!databaseName) {
    throw new Error("TEST_DATABASE_URL harus menyertakan nama database");
  }

  await createDatabase(connectionString, databaseName);
  return databaseName;
}

module.exports = {
  getDatabaseName,
  buildDatabaseUrl,
  getMaintenanceUrl,
  getSslConfig,
  quoteIdentifier,
  createMaintenanceClient,
  databaseExists,
  createDatabase,
  dropDatabase,
  ensureTestDatabase,
};
