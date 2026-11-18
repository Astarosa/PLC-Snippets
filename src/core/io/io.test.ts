import { describe, expect, it } from "vitest";
import { sampleSnippets } from "../../storage/sample-library";
import { buildSource } from "../export/source";
import { parseRawSnippet } from "../snippet/parse";
import type { Snippet } from "../snippet/schema";
import { defaultChoice, planImport, uniqueId } from "./apply";
import { plcSnippetsAdapter } from "./plcsnippets";
import { exportAdapter, previewImport } from "./registry";
import { parseTiaSource, tiaAwlAdapter, tiaSclAdapter } from "./tia-source";
import type { ExportResult, ImportSource, SourceFile } from "./types";

const NOW = "2026-11-18T12:00:00.000Z";
const samples: Snippet[] = sampleSnippets(NOW).flatMap((raw) => {
  const r = parseRawSnippet(raw);
  return r.ok ? [r.snippet] : [];
});
const byId = (id: string) => samples.find((s) => s.id === id) as Snippet;
const source = (
  files: SourceFile[],
  kind: ImportSource["kind"] = "zip",
  name = "pack.zip",
): ImportSource => ({
  kind,
  name,
  files,
  skipped: [],
});
const zipFiles = (r: ExportResult) => {
  if (r.kind !== "zip") throw new Error("zip attendu");
  return r.files;
};

describe("format PLC Snippets", () => {
  it("fait l'aller-retour export → import sans rien perdre", () => {
    const files = zipFiles(plcSnippetsAdapter.export?.(samples) as ExportResult);
    expect(files.map((f) => f.path)).toContain("marche-arret-auto-maintien/main.awl");
    const preview = previewImport(source(files));
    expect(preview.format).toEqual({ id: "plcsnippets", label: "PLC Snippets (.zip)", lossless: true });
    expect(preview.items.map((i) => i.errors)).toEqual([[], [], []]);
    for (const item of preview.items) {
      expect(item.snippet).toEqual(byId(item.id));
    }
  });

  it("trouve les snippets dans un dossier racine (zip créé par Windows) ou à la racine", () => {
    const files = zipFiles(plcSnippetsAdapter.export?.([byId("machine-etat-convoyeur")]) as ExportResult);
    const nested = files.map((f) => ({ ...f, path: `Mes snippets/${f.path}` }));
    expect(previewImport(source(nested)).items[0].id).toBe("machine-etat-convoyeur");
    const flat = files.map((f) => ({ ...f, path: f.path.split("/").pop() as string }));
    const item = previewImport(source(flat, "dir", "Mon Super Snippet")).items[0];
    expect(item.id).toBe("machine-d-etat-convoyeur-avec-surveillance-de-transfert");
    expect(item.snippet?.meta.title).toBe(byId("machine-etat-convoyeur").meta.title);
  });

  it("signale les snippets illisibles ou trop récents sans bloquer les autres", () => {
    const files = zipFiles(plcSnippetsAdapter.export?.([byId("machine-etat-convoyeur")]) as ExportResult);
    const newer = files
      .filter((f) => f.path.endsWith("snippet.json"))
      .map((f) => ({
        path: "futur/snippet.json",
        content: f.content.replace('"schemaVersion": 1', '"schemaVersion": 99'),
      }));
    const preview = previewImport(source([...files, ...newer, { path: "casse/snippet.json", content: "{" }]));
    expect(preview.items.map((i) => [i.id, i.snippet !== null])).toEqual([
      ["machine-etat-convoyeur", true],
      ["futur", false],
      ["casse", false],
    ]);
    expect(preview.items[1].errors[0]).toContain("version plus récente");
  });

  it("refuse une source sans format reconnu et rapporte les fichiers ignorés", () => {
    const preview = previewImport({
      kind: "zip",
      name: "x.zip",
      files: [{ path: "a.txt", content: "" }],
      skipped: ["img.png : pas un fichier texte"],
    });
    expect(preview.format).toBeNull();
    expect(preview.warnings[0]).toBe("Ignoré : img.png : pas un fichier texte");
    expect(preview.warnings[1]).toContain("Aucun format reconnu");
  });
});

describe("sources externes TIA", () => {
  it("relit un FB exporté par l'app : interface et corps identiques", () => {
    const fb = byId("machine-etat-convoyeur");
    const exported = buildSource(fb, { format: "SCL", blockName: "FB_Convoyeur" });
    if (!exported.ok) throw new Error(exported.error);
    const preview = previewImport(
      source([{ path: "FB_Convoyeur.scl", content: exported.source }], "file", "FB_Convoyeur.scl"),
    );
    expect(preview.format?.id).toBe("tia-scl");
    const [item] = preview.items;
    expect(item.id).toBe("fb-convoyeur");
    expect(item.warnings).toContain("Source TIA : seul le SCL est importé (pas de LADDER ni de notes)");
    const snippet = item.snippet as Snippet;
    expect(snippet.meta.title).toBe(fb.meta.title);
    expect(snippet.meta.summary).toBe(fb.meta.summary);
    expect(snippet.meta.blockType).toBe("FB");
    expect(snippet.meta.interface).toEqual(fb.meta.interface);
    expect(snippet.variants[0].content).toBe(fb.variants[0].content);
  });

  it("relit le LIST exporté en .awl, dans sa mnémonique", () => {
    const net = byId("marche-arret-auto-maintien");
    const exported = buildSource(net, { format: "STL", blockName: "FC_Moteur", mnemonic: "EN" });
    if (!exported.ok) throw new Error(exported.error);
    const [item] =
      tiaAwlAdapter.import?.(source([{ path: "FC_Moteur.awl", content: exported.source }])) ?? [];
    const stl = item.snippet?.variants[0];
    expect(stl).toMatchObject({ lang: "STL", mnemonic: "EN" });
    expect(stl?.content).toBe(
      'A(    \nO     "BP_Marche";\nO     "KM1";\n);     \nA     "BP_Arret";   // câblé NF\nAN    "Defaut";\n=     "KM1";\n',
    );
    expect(item.snippet?.meta.blockType).toBe("FC");
  });

  it("lit plusieurs blocs, ignore DB / OB, signale structures et valeurs de retour", () => {
    const text = `DATA_BLOCK "DB_Param"
BEGIN
END_DATA_BLOCK

FUNCTION "FC_Calc" : Int
TITLE = Calcul
   VAR_INPUT
      A : Int;
      "Mot clé" {ExternalAccessible := 'False'} : Array[0..9] of Real := [10(0.0)];   // tableau
      Config : Struct   // réglages
         Gain : Real;
      END_STRUCT;
   END_VAR
BEGIN
    #FC_Calc := #A * 2;
END_FUNCTION

FUNCTION_BLOCK FB_Simple
BEGIN
  #x := TRUE;
END_FUNCTION_BLOCK
`;
    const blocks = parseTiaSource(text, "SCL");
    expect(blocks.map((b) => [b.kind, b.name])).toEqual([
      ["DATA_BLOCK", "DB_Param"],
      ["FUNCTION", "FC_Calc"],
      ["FUNCTION_BLOCK", "FB_Simple"],
    ]);
    expect(blocks[1].iface.input).toEqual([
      { name: "A", type: "Int" },
      { name: "Mot clé", type: "Array[0..9] of Real", initial: "[10(0.0)]", comment: "tableau" },
      { name: "Config", type: "Struct", comment: "réglages" },
    ]);

    const items = tiaSclAdapter.import?.(source([{ path: "src.scl", content: text }])) ?? [];
    expect(items.map((i) => i.snippet !== null)).toEqual([false, true, true]);
    expect(items[0].errors[0]).toContain("seuls les FB et les FC");
    expect(items[1].warnings.join("\n")).toContain("Valeur de retour de la FC (Int)");
    expect(items[1].warnings.join("\n")).toContain("Config : structure importée");
    expect(items[2].snippet?.variants[0].content).toBe("#x := TRUE;\n");
  });

  it("exporte plusieurs snippets dans une seule source, en signalant ceux qui ne peuvent pas l'être", () => {
    const adapter = exportAdapter("tia-awl");
    const result = adapter?.export?.(samples);
    if (result?.kind !== "text") throw new Error();
    expect(result.content.match(/^FUNCTION/gm)).toHaveLength(1);
    expect(result.warnings).toHaveLength(2);
    expect(tiaSclAdapter.canExport?.(byId("machine-etat-convoyeur"))).toBeNull();
    expect(tiaAwlAdapter.canExport?.(byId("machine-etat-convoyeur"))).toBe("pas de LIST");
  });
});

describe("planImport (doublons)", () => {
  const files = zipFiles(plcSnippetsAdapter.export?.(samples) as ExportResult);
  // Ordre fixe pour les tests : convoyeur, marche-arrêt, surveillance.
  const items = [...previewImport(source(files)).items].sort((a, b) => a.id.localeCompare(b.id));
  const existing = ["machine-etat-convoyeur", "marche-arret-auto-maintien", "marche-arret-auto-maintien-2"];

  it("garde les deux par défaut, avec un identifiant libre", () => {
    const plan = planImport(items, existing, items.map(defaultChoice));
    expect(plan.map((p) => [p.raw.id, p.mode])).toEqual([
      ["machine-etat-convoyeur-2", "create"],
      ["marche-arret-auto-maintien-3", "create"],
      ["surveillance-bourrage-comptage", "create"],
    ]);
  });

  it("remplace, ignore ou décoche selon les choix", () => {
    const plan = planImport(items, existing, [
      { include: true, conflict: "replace" },
      { include: true, conflict: "skip" },
      { include: false, conflict: "keep-both" },
    ]);
    expect(plan.map((p) => [p.raw.id, p.mode])).toEqual([["machine-etat-convoyeur", "replace"]]);
  });

  it("n'écrase jamais deux snippets du même import", () => {
    const twice = [items[0], items[0]];
    const plan = planImport(twice, [], twice.map(defaultChoice));
    expect(plan.map((p) => p.raw.id)).toEqual(["machine-etat-convoyeur", "machine-etat-convoyeur-2"]);
  });

  it("limite les identifiants à 80 caractères", () => {
    const long = "a".repeat(80);
    expect(uniqueId(long, new Set([long]))).toHaveLength(80);
    expect(uniqueId(long, new Set([long])).endsWith("-2")).toBe(true);
  });
});
