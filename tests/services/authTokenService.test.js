const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const db = require("../../src/config/db");
const {
  hashRefreshToken,
  readRefreshTtlSeconds,
  createAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshTokenFamily,
  revokeAllRefreshTokens,
} = require("../../src/services/authTokenService");

const runDbTests = process.env.RUN_DB_TESTS === "1";
const dbTest = (name, fn) => test(name, { skip: !runDbTests }, fn);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const uniqueEmail = (prefix) =>
  `${prefix}-${suffix}-${Math.random().toString(16).slice(2)}@example.com`;

const createUser = async (role = "user") => {
  const result = await db.query(
    `INSERT INTO users (name, email, password, role)
     VALUES ($1, $2, 'hash-tidak-dipakai', $3)
     RETURNING id, name, email, role, token_version`,
    [`Token Test ${role}`, uniqueEmail(`token-${role}`), role],
  );

  return result.rows[0];
};

const deleteUser = (userId) =>
  db.query("DELETE FROM users WHERE id = $1", [userId]);

const invalidRefreshError = (error) => {
  assert.equal(error.statusCode, 401);
  assert.match(error.message, /refresh token/i);
  return true;
};

after(async () => {
  await db.pool.end();
});

test("hashRefreshToken deterministik dan 64 hex", () => {
  const first = hashRefreshToken("token-mentah");

  assert.equal(first, hashRefreshToken("token-mentah"));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, hashRefreshToken("token-lain"));
});

test("createAccessToken memuat tokenVersion dan type portal", () => {
  const token = createAccessToken({
    user: { id: 7, email: "u@example.com", role: "user", token_version: 3 },
    portal: "user",
    env: { JWT_SECRET: "secret", JWT_EXPIRES_IN: "15m" },
  });
  const decoded = jwt.verify(token, "secret");

  assert.equal(decoded.userId, 7);
  assert.equal(decoded.email, "u@example.com");
  assert.equal(decoded.role, "user");
  assert.equal(decoded.type, "user");
  assert.equal(decoded.tokenVersion, 3);
  assert.equal(decoded.exp - decoded.iat, 15 * 60);
});

test("createAccessToken admin memakai secret dan TTL admin", () => {
  const token = createAccessToken({
    user: {
      id: 9,
      email: "admin@example.com",
      role: "admin",
      token_version: 2,
    },
    portal: "admin",
    env: { ADMIN_JWT_SECRET: "admin-secret" },
  });
  const decoded = jwt.verify(token, "admin-secret");

  assert.equal(decoded.type, "admin");
  assert.equal(decoded.tokenVersion, 2);
  assert.equal(decoded.exp - decoded.iat, 30 * 60);
});

test("readRefreshTtlSeconds memakai default dan menolak nilai non-positif", () => {
  assert.equal(readRefreshTtlSeconds("user", {}), 2592000);
  assert.equal(readRefreshTtlSeconds("admin", {}), 28800);
  assert.equal(
    readRefreshTtlSeconds("user", { REFRESH_TOKEN_TTL_SECONDS: "120" }),
    120,
  );
  assert.equal(
    readRefreshTtlSeconds("admin", { ADMIN_REFRESH_TOKEN_TTL_SECONDS: "60" }),
    60,
  );
  assert.equal(
    readRefreshTtlSeconds("user", { REFRESH_TOKEN_TTL_SECONDS: "0" }),
    2592000,
  );
  assert.equal(
    readRefreshTtlSeconds("admin", { ADMIN_REFRESH_TOKEN_TTL_SECONDS: "-1" }),
    28800,
  );
});

dbTest("issueRefreshToken menyimpan hash, bukan token mentah", async () => {
  const user = await createUser();

  try {
    const issued = await issueRefreshToken({
      userId: user.id,
      portal: "user",
      tokenVersion: user.token_version,
    });

    assert.match(issued.token, /^[A-Za-z0-9_-]+$/);
    assert.ok(issued.expiresAt instanceof Date);

    const stored = await db.query(
      `SELECT token_hash, family_id, portal, token_version, expires_at
       FROM refresh_tokens WHERE user_id = $1`,
      [user.id],
    );

    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].token_hash, hashRefreshToken(issued.token));
    assert.notEqual(stored.rows[0].token_hash, issued.token);
    assert.equal(stored.rows[0].portal, "user");
    assert.equal(stored.rows[0].token_version, user.token_version);
    assert.ok(new Date(stored.rows[0].expires_at) > new Date());
  } finally {
    await deleteUser(user.id);
  }
});

dbTest(
  "rotasi mencabut token lama dan mempertahankan family",
  async () => {
    const user = await createUser();

    try {
      const issued = await issueRefreshToken({
        userId: user.id,
        portal: "user",
        tokenVersion: user.token_version,
      });
      const rotated = await rotateRefreshToken({
        token: issued.token,
        portal: "user",
      });

      assert.notEqual(rotated.token, issued.token);
      assert.equal(rotated.user.id, user.id);
      assert.equal(rotated.user.email, user.email);
      assert.equal(rotated.user.role, "user");

      const decoded = jwt.verify(rotated.accessToken, process.env.JWT_SECRET);
      assert.equal(decoded.userId, user.id);
      assert.equal(decoded.tokenVersion, user.token_version);

      const rows = await db.query(
        `SELECT id, token_hash, family_id, revoked_at, replaced_by_id
         FROM refresh_tokens WHERE user_id = $1 ORDER BY id`,
        [user.id],
      );

      assert.equal(rows.rows.length, 2);

      const [oldRow, newRow] = rows.rows;
      assert.ok(oldRow.revoked_at);
      assert.equal(oldRow.replaced_by_id, newRow.id);
      assert.equal(oldRow.family_id, newRow.family_id);
      assert.equal(newRow.revoked_at, null);
      assert.equal(newRow.token_hash, hashRefreshToken(rotated.token));
    } finally {
      await deleteUser(user.id);
    }
  },
);

dbTest("replay token lama mencabut seluruh family", async () => {
  const user = await createUser();

  try {
    const issued = await issueRefreshToken({
      userId: user.id,
      portal: "user",
      tokenVersion: user.token_version,
    });
    const rotated = await rotateRefreshToken({
      token: issued.token,
      portal: "user",
    });

    await assert.rejects(
      () => rotateRefreshToken({ token: issued.token, portal: "user" }),
      invalidRefreshError,
    );
    await assert.rejects(
      () => rotateRefreshToken({ token: rotated.token, portal: "user" }),
      invalidRefreshError,
    );

    const rows = await db.query(
      "SELECT revoked_at FROM refresh_tokens WHERE user_id = $1",
      [user.id],
    );

    assert.ok(rows.rows.length >= 2);
    for (const row of rows.rows) {
      assert.ok(row.revoked_at, "semua token family harus dicabut");
    }
  } finally {
    await deleteUser(user.id);
  }
});

dbTest(
  "refresh kedaluwarsa, versi, dan role yang berubah ditolak",
  async () => {
    const expiredUser = await createUser();
    const versionUser = await createUser();
    const roleUser = await createUser();

    try {
      const expired = await issueRefreshToken({
        userId: expiredUser.id,
        portal: "user",
        tokenVersion: expiredUser.token_version,
      });
      await db.query(
        `UPDATE refresh_tokens
         SET expires_at = NOW() - INTERVAL '1 second'
         WHERE token_hash = $1`,
        [hashRefreshToken(expired.token)],
      );
      await assert.rejects(
        () => rotateRefreshToken({ token: expired.token, portal: "user" }),
        invalidRefreshError,
      );

      const versioned = await issueRefreshToken({
        userId: versionUser.id,
        portal: "user",
        tokenVersion: versionUser.token_version,
      });
      await db.query(
        "UPDATE users SET token_version = token_version + 1 WHERE id = $1",
        [versionUser.id],
      );
      await assert.rejects(
        () => rotateRefreshToken({ token: versioned.token, portal: "user" }),
        invalidRefreshError,
      );

      const versionRows = await db.query(
        "SELECT revoked_at FROM refresh_tokens WHERE user_id = $1",
        [versionUser.id],
      );
      assert.ok(versionRows.rows[0].revoked_at);

      const roleToken = await issueRefreshToken({
        userId: roleUser.id,
        portal: "user",
        tokenVersion: roleUser.token_version,
      });
      await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [
        roleUser.id,
      ]);
      await assert.rejects(
        () => rotateRefreshToken({ token: roleToken.token, portal: "user" }),
        invalidRefreshError,
      );

      const roleRows = await db.query(
        "SELECT revoked_at FROM refresh_tokens WHERE user_id = $1",
        [roleUser.id],
      );
      assert.ok(roleRows.rows[0].revoked_at);
    } finally {
      await deleteUser(expiredUser.id);
      await deleteUser(versionUser.id);
      await deleteUser(roleUser.id);
    }
  },
);

dbTest("revoke family dan revoke all mencabut baris aktif", async () => {
  const user = await createUser();

  try {
    const first = await issueRefreshToken({
      userId: user.id,
      portal: "user",
      tokenVersion: user.token_version,
    });
    const second = await issueRefreshToken({
      userId: user.id,
      portal: "user",
      tokenVersion: user.token_version,
    });

    assert.equal(
      await revokeRefreshTokenFamily({ token: first.token, portal: "user" }),
      true,
    );

    const active = await db.query(
      `SELECT token_hash FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    assert.equal(active.rows.length, 1);
    assert.equal(active.rows[0].token_hash, hashRefreshToken(second.token));

    assert.equal(
      await revokeRefreshTokenFamily({ token: first.token, portal: "user" }),
      false,
    );
    assert.equal(
      await revokeRefreshTokenFamily({
        token: "token-tidak-dikenal",
        portal: "user",
      }),
      false,
    );

    assert.equal(await revokeAllRefreshTokens({ userId: user.id }), 1);
    assert.equal(await revokeAllRefreshTokens({ userId: user.id }), 0);

    const remaining = await db.query(
      `SELECT COUNT(*)::int AS count FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    assert.equal(remaining.rows[0].count, 0);
  } finally {
    await deleteUser(user.id);
  }
});

dbTest("portal isolation menolak token portal lain", async () => {
  const admin = await createUser("admin");

  try {
    const issued = await issueRefreshToken({
      userId: admin.id,
      portal: "admin",
      tokenVersion: admin.token_version,
    });

    await assert.rejects(
      () => rotateRefreshToken({ token: issued.token, portal: "user" }),
      invalidRefreshError,
    );

    const rows = await db.query(
      "SELECT revoked_at FROM refresh_tokens WHERE user_id = $1",
      [admin.id],
    );
    assert.equal(rows.rows[0].revoked_at, null);
  } finally {
    await deleteUser(admin.id);
  }
});

dbTest("dua rotasi paralel tidak menghasilkan 500", async () => {
  const user = await createUser();

  try {
    const issued = await issueRefreshToken({
      userId: user.id,
      portal: "user",
      tokenVersion: user.token_version,
    });

    const results = await Promise.allSettled([
      rotateRefreshToken({ token: issued.token, portal: "user" }),
      rotateRefreshToken({ token: issued.token, portal: "user" }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.ok(fulfilled.length >= 1);
    assert.equal(fulfilled.length + rejected.length, 2);

    for (const result of rejected) {
      assert.equal(result.reason.statusCode, 401);
    }

    const active = await db.query(
      `SELECT COUNT(*)::int AS count FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    assert.equal(active.rows[0].count, 0);
  } finally {
    await deleteUser(user.id);
  }
});
