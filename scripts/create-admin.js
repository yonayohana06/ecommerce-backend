#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const db = require("../src/config/db");
const { parseArgs, readStdin, createOrUpdateAdmin } = require("./lib/admin");

const USAGE = `Penggunaan:
  npm run create:admin -- --email <email> --name "<nama>" [--phone <nomor>] [opsi]

Opsi:
  --update           Perbarui name/password jika email sudah terdaftar sebagai admin
  --password-stdin   Baca password dari stdin (aman untuk script/CI)
  --password <pw>    Password langsung di argumen (tidak disarankan: tercatat di shell history)

Jika tidak ada --password atau --password-stdin, password akan diminta secara interaktif
dan tidak ditampilkan di layar.

Contoh:
  npm run create:admin -- --email admin3@fastshop.id --name "Admin Ketiga"
  printf '%s' 'password-kuat' | npm run create:admin -- --email admin3@fastshop.id --name "Admin Ketiga" --password-stdin
  npm run create:admin -- --email admin3@fastshop.id --name "Admin Ketiga" --update`;

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      reject(
        new Error(
          "Tidak ada TTY untuk prompt password. Gunakan --password-stdin.",
        ),
      );
      return;
    }

    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }

        if (char === "\u0003") {
          cleanup();
          reject(new Error("Dibatalkan oleh pengguna"));
          return;
        }

        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }

        value += char;
      }
    };

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.resume();
  });
}

async function resolvePassword(args) {
  if (args.password !== undefined && args.passwordStdin) {
    throw new Error("Gunakan salah satu: --password atau --password-stdin.");
  }

  if (args.password !== undefined) {
    return args.password;
  }

  if (args.passwordStdin) {
    return readStdin(process.stdin);
  }

  const password = await promptHidden("Password admin: ");
  const confirmation = await promptHidden("Ulangi password: ");

  if (password !== confirmation) {
    throw new Error("Password tidak sama.");
  }

  return password;
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const args = parseArgs(argv);

  if (!args.email || !args.name) {
    throw new Error(`--email dan --name wajib diisi.\n\n${USAGE}`);
  }

  const password = await resolvePassword(args);

  const result = await createOrUpdateAdmin({
    ...args,
    password,
    query: db.query,
  });

  if (result.action === "created") {
    console.log(
      `✅ Admin berhasil dibuat: ${result.admin.email} (id: ${result.admin.id})`,
    );
  } else if (result.action === "updated") {
    console.log(
      `✅ Admin berhasil diperbarui: ${result.admin.email} (id: ${result.admin.id})`,
    );
  } else {
    console.log(
      `ℹ️  Admin sudah ada: ${result.admin.email} (id: ${result.admin.id}). Gunakan --update untuk memperbarui.`,
    );
  }
}

main()
  .catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
