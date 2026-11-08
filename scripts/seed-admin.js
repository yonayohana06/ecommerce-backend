require("dotenv").config({ quiet: true });

const db = require("../src/config/db");
const { createOrUpdateAdmin } = require("./lib/admin");

const email = (process.env.ADMIN_EMAIL || "").trim();
const password = process.env.ADMIN_PASSWORD || "";
const name = (process.env.ADMIN_NAME || "Administrator").trim();
const phoneNumber = (process.env.ADMIN_PHONE_NUMBER || "").trim() || undefined;
const shouldUpdate = process.argv.includes("--update");

const seedAdmin = async () => {
  if (!email) {
    throw new Error("ADMIN_EMAIL wajib diisi di .env");
  }

  if (!password) {
    throw new Error("ADMIN_PASSWORD wajib diisi di .env");
  }

  const result = await createOrUpdateAdmin({
    email,
    name,
    password,
    phoneNumber,
    update: shouldUpdate,
    query: db.query,
  });

  if (result.action === "created") {
    console.log(
      `✅ Admin pertama berhasil dibuat: ${result.admin.email} (id: ${result.admin.id})`,
    );
    console.log("   Password tersimpan di ADMIN_PASSWORD pada .env.");
  } else if (result.action === "updated") {
    console.log(
      `✅ Admin berhasil diperbarui: ${result.admin.email} (id: ${result.admin.id})`,
    );
  } else {
    console.log(
      `ℹ️  Admin sudah ada: ${result.admin.email} (id: ${result.admin.id}). Gunakan --update untuk memperbarui password.`,
    );
  }
};

seedAdmin()
  .catch((error) => {
    console.error(`❌ Gagal seed admin: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
