import { describe, expect, it } from "vitest";
import { sampleSnippets } from "../../storage/sample-library";
import { moveId, sortByOrder } from "./order";
import { parseRawSnippet } from "./parse";

const snippets = sampleSnippets().flatMap((raw) => {
  const r = parseRawSnippet(raw);
  return r.ok ? [r.snippet] : [];
});
const ids = (list: { id: string }[]) => list.map((s) => s.id);

describe("ordre des snippets", () => {
  it("trie par titre sans ordre enregistré", () => {
    expect(ids(sortByOrder(snippets, []))).toEqual([
      "machine-etat-convoyeur",
      "marche-arret-auto-maintien",
      "surveillance-bourrage-comptage",
    ]);
  });

  it("respecte l'ordre enregistré, puis range les autres par titre", () => {
    expect(ids(sortByOrder(snippets, ["surveillance-bourrage-comptage", "supprime-depuis"]))).toEqual([
      "surveillance-bourrage-comptage",
      "machine-etat-convoyeur",
      "marche-arret-auto-maintien",
    ]);
  });

  it("déplace un élément vers le haut ou le bas", () => {
    expect(moveId(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveId(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
});
