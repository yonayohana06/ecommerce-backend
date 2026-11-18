const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test(".gitignore memuat artefak lokal", () => {
  const patterns = read(".gitignore").split(/\r?\n/);
  for (const pattern of [
    ".DS_Store",
    "*.log",
    "/coverage/",
    "/.superpowers/",
  ]) {
    assert.ok(patterns.includes(pattern), `.gitignore belum memuat ${pattern}`);
  }
});

test("entrypoint test memakai dotenv quiet", () => {
  for (const file of ["scripts/prepare-test-db.js", "tests/setup.js"]) {
    assert.match(
      read(file),
      /require\("dotenv"\)\.config\(\{ quiet: true \}\)/,
      `${file} belum memakai dotenv quiet`,
    );
  }
});

test("SUPABASE_PUBLISHABLE_KEY tidak lagi disetel di setup dan CI", () => {
  assert.doesNotMatch(read("tests/setup.js"), /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(
    read(".github/workflows/test.yml"),
    /SUPABASE_PUBLISHABLE_KEY/,
  );
});
