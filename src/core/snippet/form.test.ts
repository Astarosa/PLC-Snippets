import { describe, expect, it } from "vitest";
import { sampleSnippets } from "../../storage/sample-library";
import { emptyForm, formFromSnippet, formToRaw, parseTags } from "./form";
import { parseRawSnippet } from "./parse";

const NOW = "2026-11-18T12:00:00.000Z";

function filledForm() {
  const form = emptyForm();
  form.id = "tempo-defaut";
  form.title = "Tempo défaut capteur";
  form.scl.content = '"Defaut" := "T_Capteur".Q;';
  form.lad.enabled = false;
  return form;
}

describe("formToRaw", () => {
  it("produit un snippet relisible par parseRawSnippet", () => {
    const result = formToRaw(filledForm(), NOW);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const parsed = parseRawSnippet(result.raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.snippet.meta.createdAt).toBe(NOW);
      expect(parsed.snippet.variants.map((v) => v.lang)).toEqual(["SCL"]);
      expect(parsed.snippet.variants[0].content.endsWith("\n")).toBe(true);
    }
  });

  it("refuse un formulaire vide avec des messages clairs", () => {
    const result = formToRaw(emptyForm(), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("Le titre est obligatoire.");
      expect(result.errors.some((e) => e.startsWith("Identifiant invalide"))).toBe(true);
    }
  });

  it("exige au moins une variante non vide", () => {
    const form = filledForm();
    form.scl.enabled = false;
    expect(formToRaw(form, NOW).ok).toBe(false);
    form.scl.enabled = true;
    form.scl.content = "   ";
    expect(formToRaw(form, NOW).ok).toBe(false);
  });

  it("nettoie l'interface et détecte les doublons (insensible à la casse)", () => {
    const form = filledForm();
    form.blockType = "FB";
    form.interface.input = [
      { name: " Marche ", type: "Bool" },
      { name: "", type: "" },
    ];
    form.interface.static = [{ name: "tempo", type: "TON_TIME", comment: " " }];
    const ok = formToRaw(form, NOW);
    if (!ok.ok) throw new Error(ok.errors.join("\n"));
    const meta = JSON.parse(ok.raw.meta);
    expect(meta.interface.input).toEqual([{ name: "Marche", type: "Bool" }]);
    expect(meta.interface.static).toEqual([{ name: "tempo", type: "TON_TIME" }]);

    form.interface.output = [{ name: "MARCHE", type: "Bool" }];
    const dup = formToRaw(form, NOW);
    expect(dup.ok).toBe(false);
  });

  it("ignore l'interface d'un NETWORK et les Static d'une FC", () => {
    const form = filledForm();
    form.interface.input = [{ name: "A", type: "Bool" }];
    form.interface.static = [{ name: "S", type: "Int" }];
    const network = formToRaw(form, NOW);
    if (!network.ok) throw new Error();
    expect(JSON.parse(network.raw.meta).interface.input).toEqual([]);

    form.blockType = "FC";
    const fc = formToRaw(form, NOW);
    if (!fc.ok) throw new Error();
    const meta = JSON.parse(fc.raw.meta);
    expect(meta.interface.input).toHaveLength(1);
    expect(meta.interface.static).toEqual([]);
  });
});

describe("LADDER dans le formulaire", () => {
  it("génère le SCL depuis le LADDER quand c'est demandé", () => {
    const form = filledForm();
    form.lad = { enabled: true, file: "main.lad", content: 'NO "A" & NC "B" -> COIL "X"' };
    form.scl = { enabled: false, file: "main.scl", content: "", generated: true };
    const result = formToRaw(form, NOW);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.raw.files.find((f) => f.name === "main.scl")?.content).toBe('"X" := "A" AND NOT "B";\n');
    expect(JSON.parse(result.raw.meta).variants[1]).toEqual({
      lang: "SCL",
      file: "main.scl",
      generated: true,
    });
  });

  it("refuse d'enregistrer un LADDER invalide, avec la position de l'erreur", () => {
    const form = filledForm();
    form.lad = { enabled: true, file: "main.lad", content: 'NO "A" COIL "X"' };
    const result = formToRaw(form, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^LADDER, ligne 1, colonne 8/);
  });

  it("garde le SCL manuel si le LADDER est désactivé", () => {
    const form = filledForm();
    form.scl.generated = true;
    const result = formToRaw(form, NOW);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(JSON.parse(result.raw.meta).variants[0].generated).toBe(false);
    expect(result.raw.files[0].content).toBe('"Defaut" := "T_Capteur".Q;\n');
  });
});

describe("LIST dans le formulaire", () => {
  it("enregistre la variante LIST avec sa mnémonique", () => {
    const form = filledForm();
    form.stl = { enabled: true, file: "main.awl", content: "U E 0.0\n= A 4.0", mnemonic: "DE" };
    const result = formToRaw(form, NOW);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(JSON.parse(result.raw.meta).variants[1]).toEqual({
      lang: "STL",
      file: "main.awl",
      mnemonic: "DE",
    });
    const parsed = parseRawSnippet(result.raw);
    if (!parsed.ok) throw new Error(parsed.invalid.errors.join("\n"));
    expect(formFromSnippet(parsed.snippet).stl).toEqual({ ...form.stl, content: "U E 0.0\n= A 4.0\n" });
  });
});

describe("formFromSnippet", () => {
  it("fait l'aller-retour sans perte sur les exemples", () => {
    for (const raw of sampleSnippets(NOW)) {
      const parsed = parseRawSnippet(raw);
      if (!parsed.ok) throw new Error();
      const back = formToRaw(formFromSnippet(parsed.snippet), "2026-12-01T00:00:00.000Z");
      if (!back.ok) throw new Error(back.errors.join("\n"));
      const reparsed = parseRawSnippet(back.raw);
      if (!reparsed.ok) throw new Error();
      // Seule la date de modification change.
      expect({ ...reparsed.snippet.meta, updatedAt: "" }).toEqual({ ...parsed.snippet.meta, updatedAt: "" });
      expect(reparsed.snippet.variants).toEqual(parsed.snippet.variants);
      expect(reparsed.snippet.meta.createdAt).toBe(NOW);
    }
  });
});

describe("parseTags", () => {
  it("découpe, nettoie et dédoublonne", () => {
    expect(parseTags(" moteur, base ,, moteur,TON ")).toEqual(["moteur", "base", "TON"]);
  });
});
