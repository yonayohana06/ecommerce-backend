const bcrypt = require("bcryptjs");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_MAX_BYTES = 72;

function normalizeEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

function validateAdminInput({ email, name, password, phoneNumber } = {}) {
  const normalizedEmail = normalizeEmail(email);

  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    throw new Error("Email admin tidak valid");
  }

  const normalizedName = String(name ?? "").trim();

  if (!normalizedName || normalizedName.length > 100) {
    throw new Error("Nama admin wajib diisi dan maksimal 100 karakter");
  }

  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password admin minimal 8 karakter");
  }

  if (Buffer.byteLength(password, "utf8") > BCRYPT_MAX_BYTES) {
    throw new Error("Password admin maksimal 72 byte (batas bcrypt)");
  }

  const result = { email: normalizedEmail, name: normalizedName };

  if (phoneNumber !== undefined && phoneNumber !== null) {
    const normalizedPhone = String(phoneNumber).trim();

    if (normalizedPhone) {
      if (normalizedPhone.length > 20) {
        throw new Error("Nomor telepon maksimal 20 karakter");
      }

      result.phoneNumber = normalizedPhone;
    }
  }

  return result;
}

function parseArgs(argv = []) {
  const parsed = {};
  const valueFlags = {
    "--email": "email",
    "--name": "name",
    "--phone": "phoneNumber",
    "--password": "password",
  };
  const booleanFlags = {
    "--update": "update",
    "--password-stdin": "passwordStdin",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (Object.hasOwn(valueFlags, arg)) {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error(`Argumen ${arg} wajib memiliki nilai`);
      }

      parsed[valueFlags[arg]] = value;
      index += 1;
      continue;
    }

    if (Object.hasOwn(booleanFlags, arg)) {
      parsed[booleanFlags[arg]] = true;
      continue;
    }

    throw new Error(`Argumen tidak dikenal: ${arg}`);
  }

  return parsed;
}

function readStdin(stream = process.stdin) {
  return new Promise((resolve, reject) => {
    stream.setEncoding("utf8");

    let value = "";

    stream.on("data", (chunk) => {
      value += chunk;
    });

    stream.on("error", reject);

    stream.on("end", () => {
      resolve(value.replace(/[\r\n]+$/, ""));
    });

    stream.resume();
  });
}

async function createOrUpdateAdmin({
  email,
  name,
  password,
  phoneNumber,
  update = false,
  query,
} = {}) {
  if (typeof query !== "function") {
    throw new Error("Fungsi query wajib disediakan");
  }

  const input = validateAdminInput({ email, name, password, phoneNumber });

  const existingResult = await query(
    `SELECT id, name, email, role
     FROM users
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1;`,
    [input.email],
  );

  if (existingResult.rows.length > 0) {
    const existing = existingResult.rows[0];

    if (existing.role !== "admin") {
      throw new Error(
        `Email ${input.email} sudah digunakan oleh akun non-admin (id: ${existing.id})`,
      );
    }

    if (!update) {
      return { action: "exists", admin: existing };
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const updatedResult = await query(
      `UPDATE users
       SET name = $1,
           password = $2,
           phone_number = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, email, role, updated_at;`,
      [input.name, hashedPassword, input.phoneNumber ?? null, existing.id],
    );

    return { action: "updated", admin: updatedResult.rows[0] };
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const insertResult = await query(
    `INSERT INTO users (name, email, password, phone_number, role)
     VALUES ($1, $2, $3, $4, 'admin')
     RETURNING id, name, email, role, created_at;`,
    [input.name, input.email, hashedPassword, input.phoneNumber ?? null],
  );

  return { action: "created", admin: insertResult.rows[0] };
}

module.exports = {
  normalizeEmail,
  validateAdminInput,
  parseArgs,
  readStdin,
  createOrUpdateAdmin,
};
