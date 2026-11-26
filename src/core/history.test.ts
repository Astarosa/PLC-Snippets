import { describe, expect, it } from "vitest";
import { emptyHistory, GROUP_DELAY_MS, HISTORY_LIMIT, record, redo, undo } from "./history";

describe("annuler / rétablir", () => {
  it("annule puis rétablit dans l'ordre", () => {
    let h = emptyHistory<string>();
    h = record(h, "A");
    h = record(h, "B");
    // valeur courante : C
    const u1 = undo(h, "C");
    expect(u1?.value).toBe("B");
    const u2 = u1 && undo(u1.history, u1.value);
    expect(u2?.value).toBe("A");
    expect(u2 && undo(u2.history, u2.value)).toBeNull();
    const r1 = u2 && redo(u2.history, u2.value);
    expect(r1?.value).toBe("B");
    const r2 = r1 && redo(r1.history, r1.value);
    expect(r2?.value).toBe("C");
    expect(r2 && redo(r2.history, r2.value)).toBeNull();
  });

  it("une nouvelle modification efface ce qu'on pouvait rétablir", () => {
    const h = record(emptyHistory<string>(), "A");
    const u = undo(h, "B");
    if (!u) throw new Error();
    const after = record(u.history, u.value);
    expect(after.future).toEqual([]);
    expect(redo(after, "X")).toBeNull();
  });

  it("regroupe la frappe rapprochée d'un même groupe, pas les modifications visuelles", () => {
    let h = emptyHistory<string>();
    h = record(h, "a", "texte", 1000);
    h = record(h, "ab", "texte", 1000 + GROUP_DELAY_MS / 2);
    expect(h.past).toEqual(["a"]);
    h = record(h, "abc", "texte", 1000 + GROUP_DELAY_MS * 3);
    expect(h.past).toEqual(["a", "abc"]);
    h = record(h, "v1", null, 1000 + GROUP_DELAY_MS * 3);
    h = record(h, "v2", null, 1000 + GROUP_DELAY_MS * 3);
    expect(h.past).toEqual(["a", "abc", "v1", "v2"]);
  });

  it("garde au plus HISTORY_LIMIT étapes", () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = record(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(20);
  });
});
