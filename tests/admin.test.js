const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const bcrypt = require("bcryptjs");

const {
  normalizeEmail,
  validateAdminInput,
  parseArgs,
  readStdin,
  createOrUpdateAdmin,
} = require("../scripts/lib/admin");
const db = require("../src/config/db");

const runDbTests = process.env.RUN_DB_TESTS === "1";
let client;

const uniqueEmail = (prefix = "test-admin") =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

before(async () => {
  if (!runDbTests) return;
  client = await db.pool.connect();
  await client.query("BEGIN");
});

after(async () => {
  if (client) {
    await client.query("ROLLBACK");
    client.release();
  }
  await db.pool.end();
});

test("normalizeEmail men-trim dan lowercase email", () => {
  assert.equal(normalizeEmail("  Admin@Example.COM "), "admin@example.com");
});

test("validateAdminInput mengembalikan email dan name yang sudah dinormalisasi", () => {
  const result = validateAdminInput({
    email: "  Admin@Example.COM ",
    name: "  Administrator  ",
    password: "password-kuat",
  });

  assert.deepEqual(result, {
    email: "admin@example.com",
    name: "Administrator",
  });
});

test("validateAdminInput menolak email tidak valid", () => {
  assert.throws(
    () =>
      validateAdminInput({
        email: "bukan-email",
        name: "Admin",
        password: "password-kuat",
      }),
    /Email admin tidak valid/,
  );
});

test("validateAdminInput menolak password kurang dari 8 karakter", () => {
  assert.throws(
    () =>
      validateAdminInput({
        email: "admin@example.com",
        name: "Admin",
        password: "pendek",
      }),
    /minimal 8 karakter/,
  );
});

test("validateAdminInput menolak password lebih dari 72 byte", () => {
  assert.throws(
    () =>
      validateAdminInput({
        email: "admin@example.com",
        name: "Admin",
        password: "x".repeat(73),
      }),
    /maksimal 72 byte/,
  );
});

test("parseArgs membaca email, name, phone, dan update", () => {
  assert.deepEqual(
    parseArgs([
      "--email",
      "Admin@Example.com",
      "--name",
      "Admin Baru",
      "--phone",
      "08123456789",
      "--update",
    ]),
    {
      email: "Admin@Example.com",
      name: "Admin Baru",
      phoneNumber: "08123456789",
      update: true,
    },
  );
});

test("parseArgs menolak argumen tanpa nilai", () => {
  assert.throws(() => parseArgs(["--email"]), /wajib memiliki nilai/);
});

test("parseArgs menolak argumen yang tidak dikenal", () => {
  assert.throws(() => parseArgs(["--unknown"]), /Argumen tidak dikenal/);
});

test("readStdin membaca password dan membuang newline di akhir", async () => {
  const password = await readStdin(Readable.from(["password-dari-stdin\n"]));
  assert.equal(password, "password-dari-stdin");
});

test(
  "createOrUpdateAdmin membuat admin baru dengan role admin dan password ter-hash",
  { skip: !runDbTests },
  async () => {
    const email = uniqueEmail("create");
    const password = "PasswordKuat123!";

    const result = await createOrUpdateAdmin({
      email: `  ${email.toUpperCase()}  `,
      name: "Admin Test",
      password,
      query: client.query.bind(client),
    });

    assert.equal(result.action, "created");
    assert.equal(result.admin.email, email);
    assert.equal(result.admin.role, "admin");

    const row = await client.query(
      "SELECT password, role FROM users WHERE id = $1",
      [result.admin.id],
    );

    assert.equal(row.rows[0].role, "admin");
    assert.equal(await bcrypt.compare(password, row.rows[0].password), true);
  },
);

test(
  "createOrUpdateAdmin tidak membuat duplikat jika email sudah ada",
  { skip: !runDbTests },
  async () => {
    const email = uniqueEmail("exists");
    const input = {
      email,
      name: "Admin Test",
      password: "PasswordKuat123!",
      query: client.query.bind(client),
    };

    await createOrUpdateAdmin(input);
    const result = await createOrUpdateAdmin(input);

    assert.equal(result.action, "exists");
  },
);

test(
  "createOrUpdateAdmin dengan --update memperbarui password admin",
  { skip: !runDbTests },
  async () => {
    const email = uniqueEmail("update");
    const query = client.query.bind(client);

    await createOrUpdateAdmin({
      email,
      name: "Admin Lama",
      password: "PasswordLama123!",
      query,
    });

    const result = await createOrUpdateAdmin({
      email,
      name: "Admin Baru",
      password: "PasswordBaru123!",
      update: true,
      query,
    });

    assert.equal(result.action, "updated");
    assert.equal(result.admin.name, "Admin Baru");

    const row = await client.query(
      "SELECT password FROM users WHERE id = $1",
      [result.admin.id],
    );

    assert.equal(
      await bcrypt.compare("PasswordBaru123!", row.rows[0].password),
      true,
    );
  },
);

test(
  "createOrUpdateAdmin menolak email yang sudah dipakai akun non-admin",
  { skip: !runDbTests },
  async () => {
    const email = uniqueEmail("user-conflict");

    await client.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, 'user')`,
      ["User Biasa", email, "hash-tidak-dipakai"],
    );

    await assert.rejects(
      () =>
        createOrUpdateAdmin({
          email,
          name: "Admin Test",
          password: "PasswordKuat123!",
          query: client.query.bind(client),
        }),
      /non-admin/,
    );
  },
);
