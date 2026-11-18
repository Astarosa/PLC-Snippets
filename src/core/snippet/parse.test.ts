import { describe, expect, it } from "vitest";
import { sampleSnippets } from "../../storage/sample-library";
import { matchesQuery, parseRawSnippet, slugify } from "./parse";

describe("parseRawSnippet", () => {
  it("valide les snippets d'exemple", () => {
    for (const raw of sampleSnippets("2026-11-18T00:00:00.000Z")) {
      const result = parseRawSnippet(raw);
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
  });

  it("applique les valeurs par défaut (interface, tags…)", () => {
    const [raw] = sampleSnippets();
    const result = parseRawSnippet(raw);
    if (!result.ok) throw new Error("devrait être valide");
    expect(result.snippet.meta.interface.input).toEqual([]);
    expect(result.snippet.variants.map((v) => v.lang)).toEqual(["LAD", "SCL"]);
  });

  it("signale un JSON cassé", () => {
    const result = parseRawSnippet({ id: "x", meta: "{ pas du json", readme: null, files: [] });
    expect(result.ok).toBe(false);
  });

  it("signale un fichier de variante manquant", () => {
    const [raw] = sampleSnippets();
    const result = parseRawSnippet({ ...raw, files: raw.files.filter((f) => f.name !== "main.scl") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invalid.errors[0]).toContain("main.scl");
  });

  it("signale un champ obligatoire absent", () => {
    const result = parseRawSnippet({ id: "x", meta: '{"schemaVersion":1}', readme: null, files: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invalid.errors.some((e) => e.startsWith("title"))).toBe(true);
  });
});

describe("slugify", () => {
  it("produit un identifiant de dossier valide", () => {
    expect(slugify("Marche / arrêt (auto-maintien)")).toBe("marche-arret-auto-maintien");
    expect(slugify("  Tempo TON — défaut capteur  ")).toBe("tempo-ton-defaut-capteur");
  });
});

describe("matchesQuery", () => {
  const parsed = sampleSnippets().map(parseRawSnippet);
  const snippets = parsed.flatMap((r) => (r.ok ? [r.snippet] : []));

  it("cherche dans le titre, les tags et le code", () => {
    expect(snippets.filter((s) => matchesQuery(s, "convoyeur")).length).toBe(1);
    expect(snippets.filter((s) => matchesQuery(s, "KM1")).length).toBe(1);
    expect(snippets.filter((s) => matchesQuery(s, "moteur base")).length).toBe(1);
    expect(snippets.filter((s) => matchesQuery(s, "")).length).toBe(2);
  });
});
