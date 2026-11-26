import { availableFormats, buildSource, defaultBlockName } from "../export/source";
import { ladderRefusal, sclComesFromLadder } from "../ladder/check";
import { emptyInterface } from "../snippet/form";
import { CURRENT_VERSION } from "../snippet/migrate";
import { parseRawSnippet, slugify, toRawSnippet } from "../snippet/parse";
import type { BlockType, Snippet, SnippetInterface, Variable } from "../snippet/schema";
import { detectMnemonic } from "../stl/mnemonics";
import type { ExportPreferences, FormatAdapter, ImportItem, ImportSource } from "./types";

/*
 * Sources externes TIA Portal (.scl / .awl) : passerelle AVEC PERTE.
 * À l'import, on relit chaque bloc FB / FC (interface + corps). Pas de LADDER, pas de notes.
 */

export interface TiaBlock {
  kind: "FUNCTION_BLOCK" | "FUNCTION" | "ORGANIZATION_BLOCK" | "DATA_BLOCK" | "TYPE";
  name: string;
  title: string | null;
  summary: string;
  returnType: string | null;
  iface: SnippetInterface;
  body: string;
  warnings: string[];
}

const HEADER =
  /^\s*(FUNCTION_BLOCK|FUNCTION|ORGANIZATION_BLOCK|DATA_BLOCK|TYPE)\s+("([^"]+)"|([A-Za-z_]\w*))\s*(?::\s*(\S+))?/;
const SECTIONS: [RegExp, keyof SnippetInterface][] = [
  [/^VAR_INPUT\b/i, "input"],
  [/^VAR_OUTPUT\b/i, "output"],
  [/^VAR_IN_OUT\b/i, "inOut"],
  [/^VAR_TEMP\b/i, "temp"],
  [/^VAR\s+CONSTANT\b/i, "constant"],
  [/^(VAR_STAT|VAR)\b/i, "static"],
];
/** Nom [attributs] : Type [:= valeur]; [// commentaire] */
const DECL =
  /^("([^"]+)"|[A-Za-z_]\w*)\s*(?:\{[^}]*\})?\s*:\s*(.+?)\s*(?::=\s*(.+?))?\s*;\s*(?:\/\/\s*(.*))?$/;

/** Retire l'indentation commune (espaces / tabulations) d'un bloc de lignes. */
function dedent(lines: string[]): string {
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  const indents = lines.filter((l) => l.trim()).map((l) => /^[\t ]*/.exec(l)?.[0] ?? "");
  let common = indents[0] ?? "";
  for (const i of indents) while (!i.startsWith(common)) common = common.slice(0, -1);
  return lines.map((l) => (l.startsWith(common) ? l.slice(common.length) : l.trim() ? l : "")).join("\n");
}

/** Lit tous les blocs d'une source externe TIA. */
export function parseTiaSource(text: string, lang: "SCL" | "STL"): TiaBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: TiaBlock[] = [];
  let block: TiaBlock | null = null;
  let section: keyof SnippetInterface | null = null;
  let inBody = false;
  let body: string[] = [];
  let struct: { name: string; comment?: string } | null = null;

  for (const line of lines) {
    const t = line.trim();
    if (!block) {
      const h = HEADER.exec(line);
      if (h) {
        block = {
          kind: h[1] as TiaBlock["kind"],
          name: h[3] ?? h[4],
          title: null,
          summary: "",
          returnType: h[5] ?? null,
          iface: emptyInterface(),
          body: "",
          warnings: [],
        };
        section = null;
        inBody = false;
        body = [];
      }
      continue;
    }
    if (/^END_(FUNCTION_BLOCK|FUNCTION|ORGANIZATION_BLOCK|DATA_BLOCK|TYPE)\b/i.test(t)) {
      block.body = dedent(body);
      blocks.push(block);
      block = null;
      continue;
    }
    if (inBody) {
      // LIST : les en-têtes de réseau ne font pas partie du code.
      if (lang === "STL" && /^NETWORK\b/i.test(t)) continue;
      if (lang === "STL" && /^TITLE\s*=/i.test(t)) {
        const title = t.replace(/^TITLE\s*=\s*/i, "");
        if (title && title !== block.title) body.push(`// ${title}`);
        continue;
      }
      body.push(line);
      continue;
    }
    if (/^BEGIN\b/i.test(t)) {
      inBody = true;
      continue;
    }
    if (/^TITLE\s*=/i.test(t) && !section) {
      block.title = t.replace(/^TITLE\s*=\s*/i, "") || null;
      continue;
    }
    if (/^(\{|VERSION\s*:|AUTHOR\s*:|FAMILY\s*:|NAME\s*:|KNOW_HOW_PROTECT)/i.test(t)) continue;
    if (/^END_VAR\b/i.test(t)) {
      section = null;
      continue;
    }
    const sec = SECTIONS.find(([re]) => re.test(t));
    if (sec) {
      section = sec[1];
      continue;
    }
    if (!section) {
      if (t.startsWith("//"))
        block.summary = [block.summary, t.replace(/^\/\/\s?/, "")].filter(Boolean).join(" ");
      continue;
    }
    // Déclaration dans une section VAR
    if (struct) {
      if (/^END_STRUCT\s*;?/i.test(t)) {
        block.iface[section].push({
          name: struct.name,
          type: "Struct",
          ...(struct.comment ? { comment: struct.comment } : {}),
        });
        block.warnings.push(`${struct.name} : structure importée comme « Struct », à détailler à la main`);
        struct = null;
      }
      continue;
    }
    const s = /^("([^"]+)"|[A-Za-z_]\w*)\s*(?:\{[^}]*\})?\s*:\s*Struct\b\s*(?:\/\/\s*(.*))?$/i.exec(t);
    if (s) {
      struct = { name: s[2] ?? s[1], comment: s[3] };
      continue;
    }
    const d = DECL.exec(t);
    if (d) {
      const variable: Variable = {
        name: d[2] ?? d[1],
        type: d[3],
        ...(d[4] ? { initial: d[4] } : {}),
        ...(d[5] ? { comment: d[5].trim() } : {}),
      };
      block.iface[section].push(variable);
    } else if (t && !t.startsWith("//")) {
      block.warnings.push(`Déclaration non reconnue, ignorée : ${t}`);
    }
  }
  if (block) {
    block.warnings.push("Fin de bloc (END_…) manquante : le corps peut être incomplet");
    block.body = dedent(body);
    blocks.push(block);
  }
  return blocks;
}

function blockToItem(block: TiaBlock, lang: "SCL" | "STL", origin: string): ImportItem {
  const id = slugify(block.name) || "bloc-importe";
  if (block.kind !== "FUNCTION_BLOCK" && block.kind !== "FUNCTION") {
    return {
      origin,
      id,
      snippet: null,
      errors: [`${block.kind} « ${block.name} » : seuls les FB et les FC sont importés`],
      warnings: [],
    };
  }
  const blockType: BlockType = block.kind === "FUNCTION_BLOCK" ? "FB" : "FC";
  const warnings = [
    ...block.warnings,
    `Source TIA : seul le ${lang === "SCL" ? "SCL" : "LIST"} est importé (pas de LADDER ni de notes)`,
  ];
  if (block.returnType && !/^void$/i.test(block.returnType)) {
    warnings.push(`Valeur de retour de la FC (${block.returnType}) non conservée`);
  }
  if (blockType === "FC" && block.iface.static.length > 0) {
    block.iface.static = [];
    warnings.push("Variables statiques ignorées (une FC n'en a pas)");
  }
  const file = lang === "SCL" ? "main.scl" : "main.awl";
  const now = new Date().toISOString();
  const raw = toRawSnippet({
    id,
    meta: {
      schemaVersion: CURRENT_VERSION,
      title: block.title || block.name,
      summary: block.summary,
      tags: [],
      blockType,
      cpuFamilies: [],
      interface: block.iface,
      variants: [
        lang === "SCL"
          ? { lang: "SCL", file, generated: false }
          : { lang: "STL", file, mnemonic: detectMnemonic(block.body) ?? "DE" },
      ],
      createdAt: now,
      updatedAt: now,
    },
    readme: null,
    files: { [file]: block.body ? `${block.body}\n` : "" },
  });
  if (!block.body.trim()) return { origin, id, snippet: null, errors: ["Corps du bloc vide"], warnings };
  const parsed = parseRawSnippet(raw);
  return parsed.ok
    ? { origin, id, snippet: parsed.snippet, errors: [], warnings }
    : { origin, id, snippet: null, errors: parsed.invalid.errors, warnings };
}

function importTia(source: ImportSource, lang: "SCL" | "STL"): ImportItem[] {
  const ext = lang === "SCL" ? ".scl" : ".awl";
  return source.files
    .filter((f) => f.path.toLowerCase().endsWith(ext))
    .flatMap((f) => {
      const blocks = parseTiaSource(f.content, lang);
      if (blocks.length === 0) {
        return [
          {
            origin: f.path,
            id: slugify(f.path),
            snippet: null,
            errors: ["Aucun bloc FUNCTION_BLOCK / FUNCTION trouvé"],
            warnings: [],
          },
        ];
      }
      return blocks.map((b) => blockToItem(b, lang, f.path));
    });
}

const hasBlock = (content: string) =>
  /^\s*(FUNCTION_BLOCK|FUNCTION|ORGANIZATION_BLOCK|DATA_BLOCK|TYPE)\s/m.test(content);

/** Avertissement : noms globaux à créer dans TIA (PLC tags, DB…) avant de générer les blocs. */
export const globalsWarning = (names: string[]) =>
  `À créer dans TIA avant l'import (PLC tags, DB, blocs) : ${names.map((n) => `"${n}"`).join(", ")}`;

function tiaExport(lang: "SCL" | "STL") {
  const format = lang === "SCL" ? ("SCL" as const) : ("STL" as const);
  const ext = lang === "SCL" ? "scl" : "awl";
  return (snippets: Snippet[], options: ExportPreferences = {}) => {
    const warnings: string[] = [];
    const sources: string[] = [];
    const globals = new Set<string>();
    for (const snippet of snippets) {
      const result = buildSource(snippet, {
        format,
        blockName: defaultBlockName(snippet),
        mnemonic: options.stlMnemonic,
      });
      if (result.ok) {
        sources.push(result.source);
        for (const g of result.globals) globals.add(g);
      } else warnings.push(`${snippet.meta.title} : ${result.error}`);
    }
    if (lang === "STL") {
      const m = options.stlMnemonic;
      warnings.push(
        m
          ? `Mnémonique ${m === "DE" ? "allemande" : "internationale"} : elle doit correspondre au réglage de TIA (Options → Settings → General → Mnemonic)`
          : "Mnémonique d'origine de chaque snippet : vérifie qu'elle correspond au réglage de TIA",
      );
    }
    if (globals.size > 0) warnings.push(globalsWarning([...globals]));
    const fileName =
      snippets.length === 1
        ? `${defaultBlockName(snippets[0])}.${ext}`
        : `sources-${snippets.length}-blocs.${ext}`;
    return { kind: "text" as const, fileName, extension: ext, content: sources.join("\n"), warnings };
  };
}

export const tiaSclAdapter: FormatAdapter = {
  id: "tia-scl",
  label: "Source externe SCL (.scl)",
  family: "TIA Portal",
  lossless: false,
  keeps: "SCL seul",
  detect: (s) => s.files.some((f) => f.path.toLowerCase().endsWith(".scl") && hasBlock(f.content)),
  import: (s) => importTia(s, "SCL"),
  canExport: (snippet) =>
    !availableFormats(snippet).includes("SCL")
      ? "ni SCL ni LADDER"
      : sclComesFromLadder(snippet)
        ? ladderRefusal(snippet)
        : null,
  export: tiaExport("SCL"),
};

export const tiaAwlAdapter: FormatAdapter = {
  id: "tia-awl",
  label: "Source externe LIST (.awl)",
  family: "TIA Portal",
  lossless: false,
  keeps: "LIST seul",
  detect: (s) => s.files.some((f) => f.path.toLowerCase().endsWith(".awl") && hasBlock(f.content)),
  import: (s) => importTia(s, "STL"),
  canExport: (snippet) => (availableFormats(snippet).includes("STL") ? null : "pas de LIST"),
  export: tiaExport("STL"),
};
