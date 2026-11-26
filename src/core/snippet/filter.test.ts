import { describe, expect, it } from "vitest";
import { sampleSnippets } from "../../storage/sample-library";
import { filterSnippets, hasFilters, NO_FILTERS, relativeDate, tagCounts } from "./filter";
import { parseRawSnippet } from "./parse";
import type { Snippet } from "./schema";

const library: Snippet[] = sampleSnippets().map((raw) => {
  const r = parseRawSnippet(raw);
  if (!r.ok) throw new Error(r.invalid.errors.join());
  return r.snippet;
});
const ids = (list: Snippet[]) => list.map((s) => s.id).sort();

describe("filtres de la bibliothèque", () => {
  it("sans filtre, tout passe", () => {
    expect(filterSnippets(library, NO_FILTERS)).toHaveLength(library.length);
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it("type de bloc : l'un des types cochés", () => {
    const fb = filterSnippets(library, { ...NO_FILTERS, blockTypes: ["FB"] });
    expect(fb.every((s) => s.meta.blockType === "FB")).toBe(true);
    const both = filterSnippets(library, { ...NO_FILTERS, blockTypes: ["FB", "NETWORK"] });
    expect(both.length).toBe(library.length);
  });

  it("langage : le snippet a l'une des variantes cochées", () => {
    const list = filterSnippets(library, { ...NO_FILTERS, langs: ["STL"] });
    expect(ids(list)).toEqual(["marche-arret-auto-maintien"]);
  });

  it("tags : tous les tags demandés, sans tenir compte de la casse", () => {
    const tag = library[0].meta.tags[0];
    const list = filterSnippets(library, { ...NO_FILTERS, tags: [tag.toUpperCase()] });
    expect(list.map((s) => s.id)).toContain(library[0].id);
    expect(filterSnippets(library, { ...NO_FILTERS, tags: [tag, "inexistant"] })).toEqual([]);
  });

  it("familles combinées en ET, avec le texte libre", () => {
    const f = { query: "bourrage", blockTypes: ["NETWORK" as const], langs: ["LAD" as const], tags: [] };
    expect(ids(filterSnippets(library, f))).toEqual(["surveillance-bourrage-comptage"]);
    expect(hasFilters(f)).toBe(true);
  });

  it("compte les tags du plus fréquent au moins fréquent", () => {
    const counts = tagCounts(library);
    expect(counts.length).toBeGreaterThan(0);
    for (let i = 1; i < counts.length; i++)
      expect(counts[i - 1].count).toBeGreaterThanOrEqual(counts[i].count);
  });
});

describe("relativeDate", () => {
  const now = new Date("2026-11-26T15:00:00");
  it("formule les dates récentes en clair", () => {
    expect(relativeDate("2026-11-26T14:59:40", now)).toBe("à l'instant");
    expect(relativeDate("2026-11-26T14:50:00", now)).toBe("il y a 10 min");
    expect(relativeDate("2026-11-26T12:00:00", now)).toBe("il y a 3 h");
    expect(relativeDate("2026-11-25T09:00:00", now)).toBe("hier");
    expect(relativeDate("2026-11-22T09:00:00", now)).toBe("22 nov.");
    expect(relativeDate("2025-03-02T09:00:00", now)).toBe("2 mars 2025");
  });
});
