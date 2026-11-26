import {
  addressProblem,
  assignAddresses,
  canonicalAddress,
  formatAddress,
  parseAddress,
} from "../snippet/plc-tags";
import type { PlcTag, Snippet } from "../snippet/schema";
import type { Mnemonic } from "../stl/mnemonics";
import type { ExportPreferences, ExportResult, FormatAdapter, SourceFile } from "./types";

/*
 * Table des variables API au format Excel de TIA Portal (« PLC tags »).
 * Dans TIA : Variables API → ouvrir une table → bouton « Importer » (icône tableur),
 * choisir le .xlsx. La colonne Path donne la table de destination (créée si besoin).
 *
 * Mêmes colonnes que l'export Excel de TIA : Name, Path, Data Type, Logical Address,
 * Comment, Hmi Visible, Hmi Accessible, Hmi Writeable, Typeobject ID, Version ID.
 */

export const TAG_TABLE_NAME = "PLC Snippets";

const HEADERS = [
  "Name",
  "Path",
  "Data Type",
  "Logical Address",
  "Comment",
  "Hmi Visible",
  "Hmi Accessible",
  "Hmi Writeable",
  "Typeobject ID",
  "Version ID",
];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const column = (i: number) => String.fromCharCode(65 + i); // A…J suffit

/** Fichiers d'un classeur .xlsx minimal (une feuille « PLC Tags », chaînes partagées). */
export function tagsWorkbook(rows: string[][]): SourceFile[] {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const ref = (s: string) => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      index.set(s, i);
    }
    return i;
  };
  const sheetRows = rows
    .map((cells, r) => {
      const cs = cells
        .map((value, c) => (value === "" ? "" : `<c r="${column(c)}${r + 1}" t="s"><v>${ref(value)}</v></c>`))
        .join("");
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join("");

  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const ct = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  return [
    {
      path: "[Content_Types].xml",
      content: `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${ct}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="${ct}.sharedStrings+xml"/></Types>`,
    },
    {
      path: "_rels/.rels",
      content: `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      path: "xl/workbook.xml",
      content: `${xml}<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="PLC Tags" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content: `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    },
    {
      path: "xl/styles.xml",
      content: `${xml}<styleSheet xmlns="${ns}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    {
      path: "xl/worksheets/sheet1.xml",
      content: `${xml}<worksheet xmlns="${ns}"><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
    {
      path: "xl/sharedStrings.xml",
      content: `${xml}<sst xmlns="${ns}" count="${strings.length}" uniqueCount="${strings.length}">${strings
        .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
        .join("")}</sst>`,
    },
  ];
}

export class TagsExportError extends Error {}

/**
 * Réunit les variables des snippets (une seule fois par nom), attribue les adresses
 * manquantes et prépare les lignes du classeur dans la mnémonique du projet TIA.
 */
export function tagRows(
  snippets: Snippet[],
  mnemonic: Mnemonic,
): { rows: string[][]; tags: PlcTag[]; warnings: string[] } {
  const warnings: string[] = [];
  const merged = new Map<string, PlcTag>();
  for (const snippet of snippets) {
    for (const tag of snippet.meta.plcTags) {
      const problem = addressProblem(tag);
      if (problem) throw new TagsExportError(`${snippet.meta.title} — "${tag.name}" : ${problem}`);
      const k = tag.name.toLowerCase();
      const prev = merged.get(k);
      if (!prev) merged.set(k, tag);
      else if (prev.type !== tag.type || (prev.address ?? "") !== (tag.address ?? ""))
        warnings.push(
          `"${tag.name}" déclarée différemment dans plusieurs snippets : ${prev.type} ${prev.address ?? ""} gardé.`,
        );
    }
  }
  const { tags, assigned } = assignAddresses([...merged.values()]);
  if (assigned.length > 0)
    warnings.push(
      `Adresses attribuées (à vérifier dans ton projet) : ${assigned.map((t) => `${t.name} ${t.address}`).join(", ")}`,
    );
  const rows = [
    HEADERS,
    ...tags.map((t) => {
      const a = t.address ? parseAddress(t.address) : null;
      return [
        t.name,
        TAG_TABLE_NAME,
        t.type,
        a ? formatAddress(a, mnemonic) : "",
        t.comment ?? "",
        "True",
        "True",
        "True",
        "",
        "",
      ];
    }),
  ];
  return { rows, tags, warnings };
}

export const plcTagsXlsxAdapter: FormatAdapter = {
  id: "tia-tags-xlsx",
  label: "Table des variables API (.xlsx)",
  family: "TIA Portal",
  lossless: false,
  keeps: "variables, adresses, commentaires",
  canExport: (snippet) => (snippet.meta.plcTags.length > 0 ? null : "pas de variables API"),
  export(snippets: Snippet[], options: ExportPreferences = {}): ExportResult {
    const { rows, tags, warnings } = tagRows(snippets, options.stlMnemonic ?? "DE");
    const name = snippets.length === 1 ? snippets[0].id : `${snippets.length}-snippets`;
    return {
      kind: "zip",
      extension: "xlsx",
      fileName: `PLCTags-${name}.xlsx`,
      files: tagsWorkbook(rows),
      warnings: tags.length === 0 ? ["aucune variable"] : warnings,
    };
  },
};

/* ---------------------------------------------------------------------------------------
 * Import : table de variables exportée de TIA (Variables API → Exporter) ou par PLC Snippets.
 * ------------------------------------------------------------------------------------- */

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** Texte d'un élément <si> ou <is> : concaténation des <t>, texte riche compris (pas les annotations phonétiques). */
const runsText = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)]
    .map((m) => unescapeXml(m[1] ?? ""))
    .join("");

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => runsText(m[1] ?? ""));
}

const columnIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
};

/** Lignes d'une feuille (cellules vides comprises, d'après leur référence A1). */
export function sheetRows(sheetXml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of sheetXml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = [];
    let next = 0;
    for (const c of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : next;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = strings[Number(v)] ?? "";
      else if (type === "inlineStr") value = runsText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (v !== undefined) value = unescapeXml(v);
      cells[col] = value;
      next = col + 1;
    }
    rows.push(Array.from(cells, (x) => x ?? ""));
  }
  return rows;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

/** En-têtes reconnus (export TIA en anglais, ou en-têtes en français écrits à la main). */
const COLUMNS = {
  name: ["name", "nom"],
  type: ["datatype", "typededonnees", "type"],
  address: ["logicaladdress", "adresselogique", "adresse", "address"],
  comment: ["comment", "commentaire"],
} as const;

export interface TagsImport {
  tags: PlcTag[];
  warnings: string[];
}

export class TagsImportError extends Error {}

/**
 * Variables API d'un classeur .xlsx (fichiers du zip). On prend la première feuille dont
 * l'en-tête a les colonnes Name et Data Type (TIA : feuille « PLC Tags »).
 */
export function readTagsWorkbook(files: SourceFile[]): TagsImport {
  const byPath = new Map(files.map((f) => [f.path.toLowerCase(), f.content]));
  const strings = sharedStrings(byPath.get("xl/sharedstrings.xml"));
  const sheets = files
    .filter((f) => /^xl\/worksheets\/[^/]+\.xml$/i.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  if (sheets.length === 0) throw new TagsImportError("Ce fichier n'est pas un classeur Excel (.xlsx).");

  for (const sheet of sheets) {
    const rows = sheetRows(sheet.content, strings);
    const header = (rows[0] ?? []).map(norm);
    const find = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
    const col = {
      name: find(COLUMNS.name),
      type: find(COLUMNS.type),
      address: find(COLUMNS.address),
      comment: find(COLUMNS.comment),
    };
    if (col.name < 0 || col.type < 0) continue;

    const tags: PlcTag[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    rows.slice(1).forEach((cells, i) => {
      const cell = (c: number) => (c < 0 ? "" : (cells[c] ?? "").trim());
      const name = cell(col.name);
      const type = cell(col.type);
      if (!name && !type) return;
      const line = i + 2;
      if (!name || !type) {
        warnings.push(`Ligne ${line} ignorée : ${name ? "type" : "nom"} manquant.`);
        return;
      }
      if (seen.has(name.toLowerCase())) {
        warnings.push(`Ligne ${line} ignorée : "${name}" apparaît deux fois.`);
        return;
      }
      seen.add(name.toLowerCase());
      const address = cell(col.address);
      const comment = cell(col.comment);
      tags.push({
        name,
        type,
        ...(address ? { address: canonicalAddress(address) } : {}),
        ...(comment ? { comment } : {}),
      });
    });
    return { tags, warnings };
  }
  throw new TagsImportError(
    "Aucune feuille avec les colonnes « Name » et « Data Type » : exporte la table depuis TIA (Variables API → Exporter).",
  );
}

/**
 * Ajoute les variables importées à la table. Une variable déjà déclarée (même nom,
 * casse ignorée comme dans TIA) garde son type ; son adresse et son commentaire vides
 * sont complétés depuis l'import.
 */
export function mergeTags(
  existing: PlcTag[],
  incoming: PlcTag[],
): { tags: PlcTag[]; added: number; completed: string[]; kept: string[] } {
  const byName = new Map(incoming.map((t) => [t.name.toLowerCase(), t]));
  const completed: string[] = [];
  const kept: string[] = [];
  const tags = existing.map((tag) => {
    const other = byName.get(tag.name.toLowerCase());
    if (!other) return tag;
    byName.delete(tag.name.toLowerCase());
    const address = tag.address?.trim() ? tag.address : other.address;
    const comment = tag.comment?.trim() ? tag.comment : other.comment;
    if (address === tag.address && comment === tag.comment) {
      kept.push(tag.name);
      return tag;
    }
    completed.push(tag.name);
    return { ...tag, ...(address ? { address } : {}), ...(comment ? { comment } : {}) };
  });
  const added = [...byName.values()];
  return { tags: [...tags, ...added], added: added.length, completed, kept };
}
