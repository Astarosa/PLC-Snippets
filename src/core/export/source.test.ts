import { describe, expect, it } from "vitest";
import { sampleSnippets } from "../../storage/sample-library";
import { emptyForm, formToRaw } from "../snippet/form";
import { parseRawSnippet } from "../snippet/parse";
import type { Snippet } from "../snippet/schema";
import { availableFormats, buildSource, defaultBlockName } from "./source";

const samples = sampleSnippets("2026-11-18T00:00:00.000Z").map((raw) => {
  const r = parseRawSnippet(raw);
  if (!r.ok) throw new Error(r.invalid.errors.join());
  return r.snippet;
});
const byId = (id: string) => samples.find((s) => s.id === id) as Snippet;

function stlSnippet(content: string): Snippet {
  const form = emptyForm();
  Object.assign(form, { id: "list-test", title: "Test LIST", blockType: "FC" });
  form.lad.enabled = false;
  form.scl.enabled = false;
  form.stl = { enabled: true, file: "main.awl", content, mnemonic: "DE" };
  form.interface.input = [{ name: "Marche", type: "Bool" }];
  const raw = formToRaw(form);
  if (!raw.ok) throw new Error(raw.errors.join());
  const parsed = parseRawSnippet(raw.raw);
  if (!parsed.ok) throw new Error();
  return parsed.snippet;
}

describe("buildSource", () => {
  it("exporte un FB complet avec son interface", () => {
    const fb = byId("machine-etat-convoyeur");
    expect(defaultBlockName(fb)).toBe("FB_MachineEtatConvoyeur");
    const result = buildSource(fb, { format: "SCL", blockName: "FB_Convoyeur" });
    if (!result.ok) throw new Error(result.error);
    const src = result.source;
    expect(result.fileName).toBe("FB_Convoyeur.scl");
    expect(src.startsWith('FUNCTION_BLOCK "FB_Convoyeur"\nTITLE = Machine d\'état')).toBe(true);
    expect(src).toContain("{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.1");
    expect(src).toContain("   VAR_INPUT \n      Marche : Bool;   // Ordre de marche\n");
    expect(src).toContain("      TempsMaxTransfert : Time := T#10S;");
    expect(src).toContain("   VAR \n      TempoTransfert : TON_TIME;\n   END_VAR");
    expect(src).toContain("   VAR CONSTANT \n      ST_ATTENTE : Int := 0;");
    expect(src).toContain("BEGIN\n\t// Surveillance");
    expect(src).toContain("\tCASE #Etape OF\n\t    #ST_ATTENTE:");
    expect(src.trimEnd().endsWith("END_FUNCTION_BLOCK")).toBe(true);
  });

  it("exporte un NETWORK en FC sans interface", () => {
    const net = byId("marche-arret-auto-maintien");
    expect(defaultBlockName(net)).toBe("FC_MarcheArretAutoMaintien");
    const result = buildSource(net, { format: "SCL", blockName: "FC_Moteur" });
    if (!result.ok) throw new Error(result.error);
    expect(result.source).toContain('FUNCTION "FC_Moteur" : Void');
    expect(result.source).not.toContain("VAR");
    expect(result.source).toContain('\t"KM1" := ("BP_Marche" OR "KM1") AND "BP_Arret" AND NOT "Defaut";');
    expect(result.source.trimEnd().endsWith("END_FUNCTION")).toBe(true);
  });

  it("génère le SCL depuis le LADDER s'il n'y a pas de SCL", () => {
    const net = byId("surveillance-bourrage-comptage");
    const ladOnly = { ...net, variants: net.variants.filter((v) => v.lang === "LAD") };
    expect(availableFormats(ladOnly)).toEqual(["SCL"]);
    const result = buildSource(ladOnly, { format: "SCL", blockName: "FC_Bourrage" });
    if (!result.ok) throw new Error(result.error);
    expect(result.source).toContain(
      '\t"T_Bourrage".TON(IN := "Convoyeur_Marche" AND NOT "Capteur_Sortie", PT := T#8S);',
    );
  });

  it("exporte le LIST en .awl, avec points-virgules et dans la mnémonique demandée", () => {
    const snippet = stlSnippet("U     #Marche\nUN    E 0.1   // arrêt\n=     A 4.0;\nM001: NOP 0");
    expect(availableFormats(snippet)).toEqual(["STL"]);
    const result = buildSource(snippet, { format: "STL", blockName: "FC_List", mnemonic: "EN" });
    if (!result.ok) throw new Error(result.error);
    expect(result.fileName).toBe("FC_List.awl");
    expect(result.source).toContain(
      [
        "BEGIN",
        "NETWORK",
        "TITLE = Test LIST",
        "      A     #Marche;",
        "      AN    I 0.1;   // arrêt",
        "      =     Q 4.0;",
        "      M001: NOP 0;",
        "END_FUNCTION",
      ].join("\n"),
    );
  });

  it("refuse une constante sans valeur et un nom de bloc invalide", () => {
    const fb = structuredClone(byId("machine-etat-convoyeur"));
    fb.meta.interface.constant.push({ name: "ST_X", type: "Int" });
    expect(buildSource(fb, { format: "SCL", blockName: "FB_X" })).toEqual({
      ok: false,
      error: "La constante ST_X n'a pas de valeur initiale.",
    });
    expect(buildSource(byId("marche-arret-auto-maintien"), { format: "SCL", blockName: 'FC_"' }).ok).toBe(
      false,
    );
  });
});

describe("noms globaux à créer dans TIA", () => {
  it("relève les variables et DB entre guillemets, hors commentaires et chaînes", async () => {
    const { globalNames } = await import("./globals");
    const body = `U "BP_Marche" // "PasCelleLa"
(* "NiCelleLa" *)
L 'texte "x"'
L "DB_Recette".consigne
= "KM1"
U "BP_Marche"`;
    expect(globalNames(body)).toEqual(["BP_Marche", "DB_Recette", "KM1"]);
    expect(globalNames(body, ["KM1"])).toEqual(["BP_Marche", "DB_Recette"]);
  });
});

describe("terminaison des lignes LIST", () => {
  it("ajoute « ; » après « U( » mais pas après un CALL multi-lignes", () => {
    const snippet = stlSnippet('U(\nO "A"\nO "B"\n)\n= "C"\nCALL "FB_X" , "DB_X" (\n  IN := "A"\n)');
    const r = buildSource(snippet, { format: "STL", blockName: "FC_Test" });
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toMatch(/^\s*U\(;$/m);
    expect(r.source).toMatch(/^\s*\);$/m);
    expect(r.source).toMatch(/CALL "FB_X" , "DB_X" \($/m);
  });
});
