import { addressProblem, assignAddresses, formatAddress, parseAddress } from "../snippet/plc-tags";
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
