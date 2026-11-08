const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "../..");

test("impor app.js tidak membuka listener HTTP", () => {
  const result = spawnSync(process.execPath, ["-e", "require('./src/app')"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: "39876",
    },
    encoding: "utf8",
    timeout: 5000,
  });

  assert.equal(
    result.status,
    0,
    `proses tidak keluar bersih: signal=${result.signal}, stderr=${result.stderr}`,
  );
});
