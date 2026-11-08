require("dotenv").config();

// Fallback agar `npm test` tetap bisa dijalankan tanpa file .env.
// Nilai nyata dari environment/.env tetap dipakai jika sudah ada.
process.env.JWT_SECRET ||= "test-user-jwt-secret";
process.env.ADMIN_JWT_SECRET ||= "test-admin-jwt-secret";
process.env.PAYMENT_SERVER_KEY ||= "test-payment-server-key";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.SUPABASE_PUBLISHABLE_KEY ||= "test-publishable-key";

const runDbTests = process.env.RUN_DB_TESTS === "1";

if (runDbTests) {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  // Node test runner menjalankan file ini di proses runner dan di setiap child.
  // Penanda mencegah child menganggap DATABASE_URL yang sudah dipetakan sebagai
  // database utama.
  if (process.env.TEST_DATABASE_URL_MAPPED === "1") {
    return;
  }

  if (!testDatabaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL wajib diisi untuk menjalankan DB test. " +
        "Contoh: postgresql://postgres:postgres@localhost:5432/fastshop_test?sslmode=disable",
    );
  }

  if (testDatabaseUrl === process.env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL tidak boleh sama dengan DATABASE_URL agar test tidak menyentuh database utama.",
    );
  }

  // src/config/db.js membaca DATABASE_URL saat pool dibuat.
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.TEST_DATABASE_URL_MAPPED = "1";
}
