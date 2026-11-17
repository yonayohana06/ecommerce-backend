const bcrypt = require("bcryptjs");

const db = require("../config/db");
const { HttpError } = require("../utils/httpError");
const { comparePassword } = require("../utils/auth");
const { revokeAllRefreshTokens } = require("./authTokenService");

const ACCOUNT_NOT_FOUND = "Akun tidak ditemukan.";
const CURRENT_PASSWORD_INVALID = "Password saat ini tidak valid.";
const SAME_PASSWORD =
  "Password baru harus berbeda dari password saat ini.";

const changePassword = async ({
  userId,
  expectedRole,
  currentPassword,
  newPassword,
}) => {
  const found = await db.query(
    "SELECT password, role FROM users WHERE id = $1 AND role = $2",
    [userId, expectedRole],
  );

  if (found.rows.length === 0) {
    throw new HttpError(404, ACCOUNT_NOT_FOUND);
  }

  const account = found.rows[0];
  const currentValid = await comparePassword(currentPassword, account.password);

  if (!currentValid) {
    throw new HttpError(400, CURRENT_PASSWORD_INVALID);
  }

  const samePassword = await comparePassword(newPassword, account.password);

  if (samePassword) {
    throw new HttpError(400, SAME_PASSWORD);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const client = await db.pool.connect();
  let finished = false;

  try {
    await client.query("BEGIN");

    const updated = await client.query(
      `UPDATE users
       SET password = $1,
           token_version = token_version + 1,
           updated_at = NOW()
       WHERE id = $2 AND role = $3
       RETURNING token_version`,
      [passwordHash, userId, expectedRole],
    );

    if (updated.rows.length === 0) {
      throw new HttpError(404, ACCOUNT_NOT_FOUND);
    }

    await revokeAllRefreshTokens({ userId, client });

    await client.query("COMMIT");
    finished = true;

    return { tokenVersion: updated.rows[0].token_version };
  } catch (error) {
    if (!finished) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  changePassword,
};
