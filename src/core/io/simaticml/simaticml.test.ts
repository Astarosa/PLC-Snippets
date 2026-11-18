/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { previewImport } from "../registry";
import { readSimaticMl } from "./read";
import { writeSimaticMl } from "./write";

const dir = fileURLToPath(new URL("../../../../fixtures/simaticml/synthetic-v17/", import.meta.url));
const load = (f: string) => readSimaticMl(readFileSync(`${dir}${f}`, "utf8"), f);
const lad = (f: string) => load(f).snippet?.variants.find((v) => v.lang === "LAD")?.content ?? "";
const scl = (f: string) => load(f).snippet?.variants.find((v) => v.lang === "SCL")?.content ?? "";

describe("import SimaticML", () => {
  it("contacts, OU et auto-maintien", () => {
    const item = load("01_contacts.xml");
    expect(item.errors).toEqual([]);
    expect(item.snippet?.meta.blockType).toBe("FC");
    expect(lad("01_contacts.xml")).toContain("( NO #Marche | NO #Moteur ) & NC #Arret -> COIL #Moteur");
    expect(scl("01_contacts.xml")).toContain("#Moteur := (#Marche OR #Moteur) AND NOT #Arret;");
  });
  it("bobines S / R et sorties parallèles", () => {
    const l = lad("02_bobines.xml");
    expect(l).toContain("NO #Bp_Set -> SET #Memoire");
    expect(l).toContain("NO #Bp_Reset -> RESET #Memoire");
    expect(l).toContain("NO #Entree_2 -> COIL #Sortie_2, COIL #Sortie_3");
  });
  it("fronts avec bit mémoire", () => {
    expect(lad("03_fronts.xml")).toContain("P #Capteur MEM=#Mem_FrontP -> COIL #Impulsion_P");
    expect(lad("03_fronts.xml")).toContain("N #Capteur MEM=#Mem_FrontN -> COIL #Impulsion_N");
  });
  it("temporisations et compteurs (DB d'instance et multi-instance)", () => {
    expect(lad("04a_ton_db_instance.xml")).toContain('TON "IEC_Timer_T04a_DB" PT=T#5S -> COIL #Tempo_OK');
    expect(lad("04b_ton_multiinstance.xml")).toContain(
      "TON #tonDelai PT=#Duree ET=#Ecoule -> COIL #Tempo_OK",
    );
    expect(lad("04c_ctu.xml")).toContain("CTU #ctuPieces R=#RAZ PV=#Consigne CV=#Compte -> COIL #Atteint");
  });
  it("MOVE, ADD et comparateurs", () => {
    const l = lad("05_boites.xml");
    expect(l).toContain("MOVE IN=#Valeur_A OUT=#Copie");
    expect(l).toContain("ADD IN1=#Valeur_A IN2=#Valeur_B OUT=#Somme");
    expect(l).toContain("CMP #Valeur_A >= 100 -> COIL #Superieur_Egal");
  });
  it("titres, commentaires, valeurs initiales", () => {
    const s = load("06_reseau_commente.xml").snippet;
    expect(s?.meta.title).toBe("Surveillance niveau");
    expect(s?.meta.interface.constant[0]).toMatchObject({ name: "SEUIL_HAUT", initial: "800" });
    expect(lad("06_reseau_commente.xml")).toContain(
      "// Déclenche l'alarme quand le niveau atteint le seuil.",
    );
  });
  it("refuse un bloc qui n'est pas en LAD", () => {
    const xml = readFileSync(`${dir}01_contacts.xml`, "utf8").replace(
      /<ProgrammingLanguage>LAD<\/ProgrammingLanguage>/,
      "<ProgrammingLanguage>SCL</ProgrammingLanguage>",
    );
    expect(readSimaticMl(xml, "x.xml").errors[0]).toMatch(/SCL/);
  });
  it("est détecté par l'import automatique", () => {
    const preview = previewImport({
      kind: "file",
      name: "01_contacts.xml",
      files: [{ path: "01_contacts.xml", content: readFileSync(`${dir}01_contacts.xml`, "utf8") }],
      skipped: [],
    });
    expect(preview.format?.id).toBe("simaticml");
    expect(preview.items[0].snippet).not.toBeNull();
  });
});

describe("vrai export TIA V20", () => {
  const realDir = fileURLToPath(new URL("../../../../fixtures/simaticml/real-v20/", import.meta.url));
  const real = readFileSync(`${realDir}Block_2.xml`, "utf8");

  it("s'importe : OU de deux contacts globaux vers une bobine, réseau vide ignoré", () => {
    const item = readSimaticMl(real, "Block_2.xml");
    expect(item.errors).toEqual([]);
    expect(item.snippet?.meta).toMatchObject({ title: "Block_2", blockType: "FC" });
    const l = item.snippet?.variants.find((v) => v.lang === "LAD")?.content;
    expect(l).toContain('NO "BPM" | NO "KM1" -> COIL "KM1"');
    expect(item.warnings.join(" ")).toMatch(/V20/);
    expect(item.warnings.join(" ")).toMatch(/Réseau 2 vide/);
  });

  it("l'export V20 reprend les en-têtes du vrai fichier", () => {
    const snippet = readSimaticMl(real, "Block_2.xml").snippet;
    if (!snippet) throw new Error("import");
    const { xml } = writeSimaticMl(snippet, "Block_2");
    for (const marker of [
      '<Engineering version="V20" />',
      "Openness/SW/Interface/v5",
      "Openness/SW/NetworkSource/FlgNet/v5",
      "<Namespace />",
      "<Culture>en-US</Culture>",
      '<Part Name="O" ',
    ]) {
      expect(xml).toContain(marker);
      expect(real).toContain(marker);
    }
    // TIA liste les Access avant les Part.
    expect(xml.indexOf("<Access")).toBeLessThan(xml.indexOf("<Part "));
    const back = readSimaticMl(xml, "Block_2.xml").snippet;
    expect(back?.variants.find((v) => v.lang === "LAD")?.content).toBe(
      snippet.variants.find((v) => v.lang === "LAD")?.content,
    );
  });

  it("l'export V17 garde FlgNet v4", () => {
    const snippet = readSimaticMl(real, "Block_2.xml").snippet;
    if (!snippet) throw new Error("import");
    const { xml } = writeSimaticMl(snippet, "Block_2", { version: "V17" });
    expect(xml).toContain("FlgNet/v4");
    expect(xml).not.toContain("<Namespace />");
  });
});

describe("export SimaticML", () => {
  const files = [
    "01_contacts.xml",
    "02_bobines.xml",
    "03_fronts.xml",
    "04a_ton_db_instance.xml",
    "04b_ton_multiinstance.xml",
    "04c_ctu.xml",
    "05_boites.xml",
    "06_reseau_commente.xml",
  ];
  it.each(files)("aller-retour export → import sans perte du LADDER : %s", (f) => {
    const snippet = load(f).snippet;
    if (!snippet) throw new Error("import");
    const out = writeSimaticMl(snippet, "Bloc");
    const back = readSimaticMl(out.xml, "Bloc.xml");
    expect(back.errors).toEqual([]);
    expect(back.snippet?.variants.find((v) => v.lang === "LAD")?.content).toBe(lad(f));
    expect(back.snippet?.meta.interface).toEqual(snippet.meta.interface);
    expect(back.snippet?.meta.blockType).toBe(snippet.meta.blockType);
  });
  it("marque l'export comme expérimental", () => {
    const snippet = load("01_contacts.xml").snippet;
    if (!snippet) throw new Error("import");
    expect(writeSimaticMl(snippet, "Bloc").warnings[0]).toMatch(/expérimental/);
  });
});
