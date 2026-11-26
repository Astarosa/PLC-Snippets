import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formToRaw } from "../snippet/form";
import { parseRawSnippet } from "../snippet/parse";
import type { Snippet } from "../snippet/schema";
import { TEMPLATES } from "../snippet/templates";
import { iecName, plcopenAdapter, plcopenProject, sclToSt, typeXml } from "./plcopen";

const fromTemplate = (id: string): Snippet => {
  const form = TEMPLATES.find((t) => t.id === id)?.build();
  if (!form) throw new Error(id);
  const raw = formToRaw(form, "2026-01-01T00:00:00.000Z");
  if (!raw.ok) throw new Error(raw.errors.join());
  const parsed = parseRawSnippet(raw.raw);
  if (!parsed.ok) throw new Error(parsed.invalid.errors.join());
  return parsed.snippet;
};

/** XML bien formé (xmllint, s'il est installé). */
function wellFormed(xml: string) {
  const file = join(mkdtempSync(join(tmpdir(), "plcopen-")), "p.xml");
  writeFileSync(file, xml);
  try {
    execFileSync("xmllint", ["--noout", file], { stdio: "pipe" });
  } catch (e) {
    const err = e as { code?: string; stderr?: Buffer };
    if (err.code === "ENOENT") return;
    throw new Error(String(err.stderr));
  }
}

describe("SCL → ST", () => {
  it("retire # et les guillemets, traduit les appels d'instance globale, garde constantes et commentaires", () => {
    const { st, instances } = sclToSt(
      '"T_Cap".TON(IN := "Capteur" AND #Marche, PT := T#3S);\n#Total := 16#FF; // "KM1" et #x en commentaire\nREGION Calcul\n  #s := \'a"b#c\';\nEND_REGION',
    );
    expect(st).toBe(
      'T_Cap(IN := Capteur AND Marche, PT := T#3S);\nTotal := 16#FF; // "KM1" et #x en commentaire\n// REGION Calcul\n  s := \'a"b#c\';\n// END_REGION',
    );
    expect([...instances]).toEqual([["T_Cap", "TON"]]);
  });

  it("renomme les noms TIA qui ne sont pas des identifiants IEC", () => {
    const { st, renamed } = sclToSt('"Pompe n°1" := #"Marche cycle";');
    expect(st).toBe("Pompe_n_1 := Marche_cycle;");
    expect(renamed.size).toBe(2);
    expect(iecName("1er défaut")).toBe("V_1er_defaut");
  });
});

describe("types", () => {
  it("traduit les types TIA", () => {
    expect(typeXml("Bool")).toBe("<BOOL/>");
    expect(typeXml("Time_Of_Day")).toBe("<TIME_OF_DAY/>");
    expect(typeXml("String[20]")).toBe('<string length="20"/>');
    expect(typeXml("Array[0..9] of Int")).toBe(
      '<array><dimension lower="0" upper="9"/><baseType><INT/></baseType></array>',
    );
    expect(typeXml("TON_TIME")).toBe('<derived name="TON"/>');
    expect(typeXml("IEC_COUNTER", new Map([["C", "CTUD"]]), "C")).toBe('<derived name="CTUD"/>');
    expect(typeXml('"UDT_Moteur"')).toBe('<derived name="UDT_Moteur"/>');
  });
});

describe("projet PLCopen", () => {
  it("FB : functionBlock avec son interface et le corps en ST", () => {
    const { xml } = plcopenProject([fromTemplate("fb-moteur")], "2026-01-01T00:00:00.000Z");
    wellFormed(xml);
    expect(xml).toContain('<pou name="FB_FbCommandeMoteur" pouType="functionBlock">');
    expect(xml).toMatch(/<inputVars>\s*<variable name="Marche"><type><BOOL\/><\/type>/);
    expect(xml).toContain("<outputVars>");
    expect(xml).toContain("Commande := (Marche OR Commande) AND Arret AND Thermique;");
    expect(xml).not.toContain("#");
    expect(xml).toContain("<instances>\n    <configurations/>");
  });

  it("NETWORK : program, variables globales et instance de compteur dans la GVL", () => {
    const { xml, warnings } = plcopenProject([fromTemplate("comptage")], "2026-01-01T00:00:00.000Z");
    wellFormed(xml);
    expect(xml).toContain('pouType="program"');
    expect(xml).toContain("C_Pieces(CU := ");
    expect(xml).toContain('<globalVars name="GVL_PLCSnippets">');
    // Bits d'E/S gardés, mots et mémentos en commentaire.
    expect(xml).toContain('<variable name="Capteur_Piece" address="%IX0.6">');
    expect(xml).toContain('<variable name="Lot_Complet" address="%QX0.2">');
    expect(xml).toMatch(/<variable name="Nb_Pieces"><type><INT\/><\/type><documentation>.*TIA : %MW20/);
    expect(xml).toContain('<variable name="C_Pieces"><type><derived name="CTU"/>');
    expect(warnings.join("\n")).toContain("Nb_Pieces (%MW20)");
    expect(warnings.join("\n")).toContain("PV et CV sont des WORD");
  });

  it("FC : function avec un type de retour, plusieurs snippets dans un seul projet", () => {
    const fc = fromTemplate("seuils");
    fc.meta.blockType = "FC";
    const result = plcopenAdapter.export?.([fc, fromTemplate("alarme")]);
    if (result?.kind !== "text") throw new Error("export texte attendu");
    wellFormed(result.content);
    expect(result.content).toContain('pouType="function"');
    expect(result.content).toContain("<returnType><BOOL/></returnType>");
    expect(result.content.match(/<pou /g)).toHaveLength(2);
    expect(result.fileName).toBe("2-snippets.xml");
  });
});
