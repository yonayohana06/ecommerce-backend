function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);

  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function summarize(durations, targetMs = 200) {
  const p95 = percentile(durations, 95);

  return {
    count: durations.length,
    p50: percentile(durations, 50),
    p95,
    max: durations.length > 0 ? Math.max(...durations) : 0,
    passed: durations.length > 0 && p95 < targetMs,
  };
}

const DEFAULT_POSTGRES_PORT = "5432";

const normalizeLoopbackHost = (hostname) =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)
    ? "localhost"
    : hostname;

function parseDatabaseUrl(value, label) {
  try {
    return new URL(String(value).trim());
  } catch {
    throw new Error(`${label} tidak valid sebagai URL database`);
  }
}

function getDatabaseTarget(value, label) {
  const url = parseDatabaseUrl(value, label);

  return {
    host: normalizeLoopbackHost(url.hostname.toLowerCase()),
    port: url.port || DEFAULT_POSTGRES_PORT,
    database: decodeURIComponent(
      url.pathname.replace(/^\/+/, "").replace(/\/+$/, ""),
    ),
  };
}

const isSameDatabase = (left, right) =>
  left.host === right.host &&
  left.port === right.port &&
  left.database === right.database;

function resolveBenchmarkDatabaseUrl({ testDatabaseUrl, databaseUrl, nodeEnv } = {}) {
  if (String(nodeEnv ?? "").trim().toLowerCase() === "production") {
    throw new Error("Benchmark tidak boleh berjalan di production");
  }

  const resolvedTestUrl = String(testDatabaseUrl ?? "").trim();

  if (!resolvedTestUrl) {
    throw new Error("TEST_DATABASE_URL wajib diisi untuk benchmark");
  }

  const testTarget = getDatabaseTarget(resolvedTestUrl, "TEST_DATABASE_URL");

  if (databaseUrl) {
    const mainTarget = getDatabaseTarget(databaseUrl, "DATABASE_URL");

    if (isSameDatabase(testTarget, mainTarget)) {
      throw new Error(
        "TEST_DATABASE_URL tidak boleh sama dengan DATABASE_URL",
      );
    }
  }

  return resolvedTestUrl;
}

module.exports = {
  percentile,
  summarize,
  resolveBenchmarkDatabaseUrl,
};
