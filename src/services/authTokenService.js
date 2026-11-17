const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

const db = require("../config/db");
const { REFRESH_PORTALS } = require("../constants/auth");
const { HttpError } = require("../utils/httpError");
const { logger } = require("../utils/logger");

const INVALID_REFRESH_MESSAGE =
  "Refresh token tidak valid atau sudah kedaluwarsa.";

const DEFAULT_REFRESH_TTL_SECONDS = Object.freeze({
  user: 2592000,
  admin: 28800,
});

const REFRESH_TTL_ENV = Object.freeze({
  user: "REFRESH_TOKEN_TTL_SECONDS",
  admin: "ADMIN_REFRESH_TOKEN_TTL_SECONDS",
});

const ACCESS_TOKEN_SETTINGS = Object.freeze({
  user: {
    secretEnv: "JWT_SECRET",
    expiresEnv: "JWT_EXPIRES_IN",
    defaultExpiresIn: "15m",
  },
  admin: {
    secretEnv: "ADMIN_JWT_SECRET",
    expiresEnv: "ADMIN_JWT_EXPIRES_IN",
    defaultExpiresIn: "30m",
  },
});

const ROLE_BY_PORTAL = Object.freeze({
  user: "user",
  admin: "admin",
});

const assertPortal = (portal) => {
  if (!REFRESH_PORTALS.includes(portal)) {
    throw new Error(`Portal refresh token tidak dikenal: ${portal}`);
  }

  return portal;
};

const invalidRefreshError = () => new HttpError(401, INVALID_REFRESH_MESSAGE);

const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const readRefreshTtlSeconds = (portal, env = process.env) => {
  assertPortal(portal);

  const parsed = Number.parseInt(env[REFRESH_TTL_ENV[portal]], 10);

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_REFRESH_TTL_SECONDS[portal];
};

const createAccessToken = ({ user, portal, env = process.env }) => {
  assertPortal(portal);

  const settings = ACCESS_TOKEN_SETTINGS[portal];
  const expiresIn = env[settings.expiresEnv] || settings.defaultExpiresIn;

  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      type: portal,
      tokenVersion: user.token_version,
    },
    env[settings.secretEnv],
    { expiresIn },
  );
};

const generateRefreshToken = () =>
  crypto.randomBytes(32).toString("base64url");

const refreshExpiry = (portal, env) =>
  new Date(Date.now() + readRefreshTtlSeconds(portal, env) * 1000);

const issueRefreshToken = async ({
  userId,
  portal,
  tokenVersion,
  env = process.env,
}) => {
  assertPortal(portal);

  const token = generateRefreshToken();
  const familyId = crypto.randomUUID();
  const expiresAt = refreshExpiry(portal, env);

  const result = await db.query(
    `INSERT INTO refresh_tokens
       (user_id, token_hash, family_id, portal, token_version, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING expires_at`,
    [
      userId,
      hashRefreshToken(token),
      familyId,
      portal,
      tokenVersion,
      expiresAt,
    ],
  );

  return { token, expiresAt: result.rows[0].expires_at };
};

const rotateRefreshToken = async ({ token, portal, env = process.env }) => {
  assertPortal(portal);

  const client = await db.pool.connect();
  let finished = false;

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT rt.id, rt.user_id, rt.family_id,
              rt.token_version AS refresh_token_version,
              rt.expires_at, rt.revoked_at,
              u.name, u.email, u.role,
              u.token_version AS user_token_version
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND rt.portal = $2
       FOR UPDATE OF rt`,
      [hashRefreshToken(token), portal],
    );

    if (result.rows.length === 0) {
      throw invalidRefreshError();
    }

    const record = result.rows[0];

    if (record.revoked_at) {
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [record.family_id],
      );
      await client.query("COMMIT");
      finished = true;

      logger.warn({
        msg: "refresh_token_reuse_detected",
        userId: record.user_id,
        familyId: record.family_id,
      });

      throw invalidRefreshError();
    }

    if (new Date(record.expires_at) <= new Date()) {
      throw invalidRefreshError();
    }

    const roleMismatch = record.role !== ROLE_BY_PORTAL[portal];
    const versionMismatch =
      record.refresh_token_version !== record.user_token_version;

    if (roleMismatch || versionMismatch) {
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [record.family_id],
      );
      await client.query("COMMIT");
      finished = true;

      throw invalidRefreshError();
    }

    const nextToken = generateRefreshToken();
    const expiresAt = refreshExpiry(portal, env);

    const inserted = await client.query(
      `INSERT INTO refresh_tokens
         (user_id, token_hash, family_id, portal, token_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        record.user_id,
        hashRefreshToken(nextToken),
        record.family_id,
        portal,
        record.user_token_version,
        expiresAt,
      ],
    );

    await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW(), replaced_by_id = $2
       WHERE id = $1`,
      [record.id, inserted.rows[0].id],
    );

    await client.query("COMMIT");
    finished = true;

    const user = {
      id: record.user_id,
      name: record.name,
      email: record.email,
      role: record.role,
      token_version: record.user_token_version,
    };
    const accessToken = createAccessToken({ user, portal, env });

    return {
      token: nextToken,
      accessToken,
      expiresAt,
      user,
    };
  } catch (error) {
    if (!finished) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    client.release();
  }
};

const revokeRefreshTokenFamily = async ({ token, portal }) => {
  assertPortal(portal);

  const result = await db.query(
    `WITH target AS (
       SELECT family_id
       FROM refresh_tokens
       WHERE token_hash = $1 AND portal = $2
     )
     UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE family_id IN (SELECT family_id FROM target)
       AND revoked_at IS NULL`,
    [hashRefreshToken(token), portal],
  );

  return result.rowCount > 0;
};

const revokeAllRefreshTokens = async ({ userId, client = db }) => {
  const result = await client.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );

  return result.rowCount;
};

module.exports = {
  hashRefreshToken,
  readRefreshTtlSeconds,
  createAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshTokenFamily,
  revokeAllRefreshTokens,
};
