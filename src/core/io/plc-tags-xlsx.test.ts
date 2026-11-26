import { describe, expect, it } from "vitest";
import type { Snippet } from "../snippet/schema";
import { plcTagsXlsxAdapter, TagsExportError, tagRows } from "./plc-tags-xlsx";

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
