const { readdirSync, statSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const directories = ["src", "scripts", "tests"];

function collectJavaScriptFiles(directory) {
  const absoluteDirectory = path.join(projectRoot, directory);
  const entries = readdirSync(absoluteDirectory);
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDirectory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      files.push(...collectJavaScriptFiles(path.join(directory, entry)));
    } else if (entry.endsWith(".js")) {
      files.push(absolutePath);
    }
  }

  return files;
}

const files = directories.flatMap(collectJavaScriptFiles);
let failed = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    failed += 1;
    console.error(`Syntax error: ${path.relative(projectRoot, file)}`);
    console.error(result.stderr.trim());
  }
}

if (failed > 0) {
  console.error(`Lint gagal: ${failed} file bermasalah.`);
  process.exit(1);
}

console.log(`Lint OK: ${files.length} file JavaScript.`);
