// Usage : node scripts/release-notes.mjs 0.3.1
// Affiche le texte de la section « ## v0.3.1 » de CHANGELOG.md (erreur si absente ou vide).
import { readFileSync } from "node:fs";

const version = process.argv[2];
const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.trim() === `## v${version}`);
if (start < 0) {
  console.error(`CHANGELOG.md : section « ## v${version} » introuvable. Ajoute les nouveautés avant de publier.`);
  process.exit(1);
}
const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
const notes = lines
  .slice(start + 1, end < 0 ? undefined : end)
  .join("\n")
  .trim();
if (!notes) {
  console.error(`CHANGELOG.md : la section « ## v${version} » est vide.`);
  process.exit(1);
}
console.log(notes);
