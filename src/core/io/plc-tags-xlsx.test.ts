import { describe, expect, it } from "vitest";
import type { Snippet } from "../snippet/schema";
import {
  mergeTags,
  plcTagsXlsxAdapter,
  readTagsWorkbook,
  sheetRows,
  TagsExportError,
  TagsImportError,
  tagRows,
  tagsWorkbook,
} from "./plc-tags-xlsx";

const snippet = (id: string, plcTags: Snippet["meta"]["plcTags"]): Snippet =>
  ({
    id,
    meta: { title: id, plcTags, interface: {}, variants: [] },
    readme: null,
    variants: [],
  }) as unknown as Snippet;

describe("table des variables API (.xlsx)", () => {
  const a = snippet("a", [
    { name: "BP_Marche", type: "Bool", address: "%I0.0", comment: "Bouton marche" },
    { name: "KM1", type: "Bool", address: "%Q0.0" },
    { name: "Compteur", type: "Int" },
  ]);
  const b = snippet("b", [{ name: "km1", type: "Bool", address: "%Q0.1" }]);

  it("écrit les colonnes de TIA, dans la mnémonique du projet", () => {
    const { rows } = tagRows([a], "DE");
    expect(rows[0]).toEqual([
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
    ]);
    expect(rows[1].slice(0, 5)).toEqual(["BP_Marche", "PLC Snippets", "Bool", "%E0.0", "Bouton marche"]);
    expect(rows[2][3]).toBe("%A0.0");
    expect(rows[3][3]).toBe("%MW1000");
    expect(tagRows([a], "EN").rows[1][3]).toBe("%I0.0");
  });

  it("fusionne les snippets et signale les déclarations différentes", () => {
    const { tags, warnings } = tagRows([a, b], "EN");
    expect(tags).toHaveLength(3);
    expect(warnings.join(" ")).toMatch(/déclarée différemment/);
    expect(warnings.join(" ")).toMatch(/Compteur %MW1000/);
  });

  it("refuse une adresse invalide", () => {
    expect(() => tagRows([snippet("c", [{ name: "X", type: "Int", address: "%I0.0" }])], "EN")).toThrow(
      TagsExportError,
    );
  });

  it("produit un classeur .xlsx (zip) avec la feuille PLC Tags", () => {
    const r = plcTagsXlsxAdapter.export?.([a], { stlMnemonic: "EN" });
    if (r?.kind !== "zip") throw new Error("zip attendu");
    expect(r.extension).toBe("xlsx");
    expect(r.fileName).toBe("PLCTags-a.xlsx");
    expect(r.files.map((f) => f.path)).toContain("xl/worksheets/sheet1.xml");
    expect(r.files.find((f) => f.path === "xl/workbook.xml")?.content).toContain('name="PLC Tags"');
    expect(plcTagsXlsxAdapter.canExport?.(snippet("vide", []))).toBe("pas de variables API");
  });
});

describe("import d'une table de variables (.xlsx)", () => {
  const sheet = (rows: string) => ({
    path: "xl/worksheets/sheet1.xml",
    content: `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  });

  it("relit un classeur exporté (aller-retour), adresses en mnémonique internationale", () => {
    const rows = [
      ["Name", "Path", "Data Type", "Logical Address", "Comment"],
      ["KM1", "Table", "Bool", "%A0.0", "Contacteur <pompe> & co"],
      ["Niveau", "Table", "Int", "%EW64", ""],
      ["Libre", "Table", "Bool", "", ""],
    ];
    expect(readTagsWorkbook(tagsWorkbook(rows))).toEqual({
      tags: [
        { name: "KM1", type: "Bool", address: "%Q0.0", comment: "Contacteur <pompe> & co" },
        { name: "Niveau", type: "Int", address: "%IW64" },
        { name: "Libre", type: "Bool" },
      ],
      warnings: [],
    });
  });

  it("lit les cellules en ligne, le texte riche, les nombres et les colonnes sautées", () => {
    const rows = sheetRows(
      '<row r="1"><c r="A1" t="inlineStr"><is><r><t>Na</t></r><r><t>me</t></r></is></c><c r="C1" t="inlineStr"><is><t>X</t></is></c></row><row r="2"/><row r="3"><c r="B3"><v>42</v></c></row>',
      [],
    );
    expect(rows).toEqual([["Name", "", "X"], [], ["", "42"]]);
  });

  it("accepte des en-têtes en français et signale les lignes incomplètes ou en double", () => {
    const strings = {
      path: "xl/sharedStrings.xml",
      content:
        "<sst><si><t>Nom</t></si><si><t>Type de données</t></si><si><t>B1</t></si><si><t>Bool</t></si></sst>",
    };
    const s = sheet(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="s"><v>3</v></c></row>' +
        '<row r="4"><c r="A4" t="inlineStr"><is><t>Seul</t></is></c></row>',
    );
    const r = readTagsWorkbook([strings, s]);
    expect(r.tags).toEqual([{ name: "B1", type: "Bool" }]);
    expect(r.warnings).toEqual([
      'Ligne 3 ignorée : "B1" apparaît deux fois.',
      "Ligne 4 ignorée : type manquant.",
    ]);
  });

  it("refuse un fichier sans feuille de variables", () => {
    expect(() => readTagsWorkbook([{ path: "a.txt", content: "" }])).toThrow(TagsImportError);
    expect(() =>
      readTagsWorkbook([sheet('<row r="1"><c t="inlineStr"><is><t>Autre</t></is></c></row>')]),
    ).toThrow(/Name/);
  });

  it("garde les variables déjà déclarées (casse ignorée) et complète adresse / commentaire vides", () => {
    const r = mergeTags(
      [
        { name: "km1", type: "Bool", address: "%Q0.1" },
        { name: "S1", type: "Bool" },
      ],
      [
        { name: "KM1", type: "Bool", address: "%Q0.0", comment: "Pompe" },
        { name: "s1", type: "Int", address: "%I0.0" },
        { name: "KM2", type: "Bool" },
      ],
    );
    expect(r).toEqual({
      tags: [
        { name: "km1", type: "Bool", address: "%Q0.1", comment: "Pompe" },
        { name: "S1", type: "Bool", address: "%I0.0" },
        { name: "KM2", type: "Bool" },
      ],
      added: 1,
      completed: ["km1", "S1"],
      kept: [],
    });
    expect(
      mergeTags([{ name: "A", type: "Bool", address: "%M0.0" }], [{ name: "a", type: "Bool" }]).kept,
    ).toEqual(["A"]);
  });
});
