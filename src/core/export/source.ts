import { generateScl } from "../snippet/form";
import type { Snippet, SnippetInterface, Variable } from "../snippet/schema";
import { convertStl, type Mnemonic } from "../stl/mnemonics";

/*
 * Génération d'une « source externe » TIA Portal : un bloc complet (FB ou FC)
 * avec son interface, à importer via Sources externes → Générer les blocs.
 *
 * - FB          → FUNCTION_BLOCK, toutes les sections d'interface
 * - FC, NETWORK → FUNCTION … : Void (un NETWORK utilise des variables API globales :
 *                 elles doivent exister dans la table des variables de l'API)
 */

export type ExportFormat = "SCL" | "STL";

export interface ExportOptions {
  format: ExportFormat;
  blockName: string;
  /** LIST uniquement : mnémonique de la source (doit correspondre au réglage du projet TIA). */
  mnemonic?: Mnemonic;
}

export type ExportResult = { ok: true; source: string; fileName: string } | { ok: false; error: string };

const toPascal = (id: string) =>
  id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");

export function defaultBlockName(snippet: Snippet): string {
  const prefix = snippet.meta.blockType === "FB" ? "FB" : "FC";
  return `${prefix}_${toPascal(snippet.id)}`;
}

/** Formats exportables : SCL si on a du SCL ou du LADDER, LIST si on a du LIST. */
export function availableFormats(snippet: Snippet): ExportFormat[] {
  const langs = snippet.variants.map((v) => v.lang);
  const formats: ExportFormat[] = [];
  if (langs.includes("SCL") || langs.includes("LAD")) formats.push("SCL");
  if (langs.includes("STL")) formats.push("STL");
  return formats;
}

const SECTIONS: { key: keyof SnippetInterface; keyword: string; fbOnly?: boolean }[] = [
  { key: "input", keyword: "VAR_INPUT" },
  { key: "output", keyword: "VAR_OUTPUT" },
  { key: "inOut", keyword: "VAR_IN_OUT" },
  { key: "static", keyword: "VAR", fbOnly: true },
  { key: "temp", keyword: "VAR_TEMP" },
  { key: "constant", keyword: "VAR CONSTANT" },
];

function declaration(v: Variable): string {
  const init = v.initial ? ` := ${v.initial}` : "";
  const comment = v.comment ? `   // ${v.comment}` : "";
  return `      ${v.name} : ${v.type}${init};${comment}`;
}

function interfaceSource(iface: SnippetInterface, isFb: boolean): { lines: string[]; error?: string } {
  const lines: string[] = [];
  for (const { key, keyword, fbOnly } of SECTIONS) {
    if (fbOnly && !isFb) continue;
    const vars = iface[key];
    if (vars.length === 0) continue;
    if (key === "constant") {
      const missing = vars.find((v) => !v.initial);
      if (missing) return { lines, error: `La constante ${missing.name} n'a pas de valeur initiale.` };
    }
    lines.push(`   ${keyword} `, ...vars.map(declaration), "   END_VAR");
    lines.push("");
  }
  return { lines };
}

/** Termine par « ; » les lignes d'instruction LIST qui n'en ont pas (exigé dans une source .awl). */
function terminateStl(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const code = line.replace(/\/\/.*$/, "").trimEnd();
      if (!code.trim() || /[;,(]$/.test(code) || /:=/.test(code) || /^\s*[A-Za-z_]\w{0,3}:$/.test(code)) {
        return line;
      }
      const comment = line.slice(code.length);
      return `${code};${comment}`;
    })
    .join("\n");
}

const indent = (text: string, prefix: string) =>
  text
    .replace(/\n+$/, "")
    .split("\n")
    .map((l) => (l.trim() ? `${prefix}${l}` : ""))
    .join("\n");

export function buildSource(snippet: Snippet, options: ExportOptions): ExportResult {
  const name = options.blockName.trim();
  if (!name || name.includes('"'))
    return { ok: false, error: "Nom de bloc invalide (vide ou avec des guillemets)." };

  const isFb = snippet.meta.blockType === "FB";
  const iface = interfaceSource(snippet.meta.interface, isFb);
  if (iface.error) return { ok: false, error: iface.error };

  let body: string;
  if (options.format === "SCL") {
    const scl = snippet.variants.find((v) => v.lang === "SCL");
    const lad = snippet.variants.find((v) => v.lang === "LAD");
    if (scl) body = scl.content;
    else if (lad) {
      const generated = generateScl(lad.content);
      if (!generated.ok) return { ok: false, error: generated.error };
      body = generated.scl;
    } else return { ok: false, error: "Ce snippet n'a ni SCL ni LADDER à exporter en SCL." };
  } else {
    const stl = snippet.variants.find((v) => v.lang === "STL");
    if (!stl) return { ok: false, error: "Ce snippet n'a pas de variante LIST." };
    const target = options.mnemonic ?? stl.mnemonic ?? "DE";
    body = terminateStl(convertStl(stl.content, stl.mnemonic ?? "DE", target));
  }

  const keyword = isFb ? "FUNCTION_BLOCK" : "FUNCTION";
  const header = isFb ? `FUNCTION_BLOCK "${name}"` : `FUNCTION "${name}" : Void`;
  const summary = snippet.meta.summary ? [`//${snippet.meta.summary}`] : [];
  const code =
    options.format === "SCL"
      ? ["BEGIN", indent(body, "\t")]
      : ["BEGIN", "NETWORK", `TITLE = ${snippet.meta.title}`, indent(body, "      ")];

  const source = [
    header,
    `TITLE = ${snippet.meta.title}`,
    "{ S7_Optimized_Access := 'TRUE' }",
    "VERSION : 0.1",
    ...summary,
    ...iface.lines,
    ...code,
    `END_${keyword}`,
    "",
  ].join("\n");

  return { ok: true, source, fileName: `${name}.${options.format === "SCL" ? "scl" : "awl"}` };
}
