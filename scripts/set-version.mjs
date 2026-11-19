// Usage : node scripts/set-version.mjs 0.3.1
// Met le même numéro de version partout : package.json, package-lock.json,
// src-tauri/tauri.conf.json, src-tauri/Cargo.toml et src-tauri/Cargo.lock.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error(`Version invalide : « ${version ?? ""} » (attendu : X.Y.Z, sans « v »)`);
  process.exit(1);
}

const edit = (file, change) => {
  const before = readFileSync(file, "utf8");
  const after = change(before);
  if (after === before) {
    console.error(`${file} : version introuvable ou déjà à ${version}`);
    process.exit(1);
  }
  writeFileSync(file, after);
};
const json = (file, change) =>
  edit(file, (text) => {
    const data = JSON.parse(text);
    change(data);
    return `${JSON.stringify(data, null, 2)}\n`;
  });

json("package.json", (p) => {
  p.version = version;
});
json("package-lock.json", (p) => {
  p.version = version;
  p.packages[""].version = version;
});
json("src-tauri/tauri.conf.json", (c) => {
  c.version = version;
});
edit("src-tauri/Cargo.toml", (t) => t.replace(/^version = "[^"]*"/m, `version = "${version}"`));
edit("src-tauri/Cargo.lock", (t) =>
  t.replace(/(name = "plc-snippets"\nversion = )"[^"]*"/, `$1"${version}"`),
);
console.log(`Version ${version} appliquée.`);
