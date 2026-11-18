import { describe, expect, it } from "vitest";
import type { LadProgram } from "./ast";
import {
  addOutput,
  addRung,
  canRemoveOutput,
  getExpr,
  insertParallel,
  insertSeries,
  newElement,
  newOutput,
  normalizeProgram,
  removeExpr,
  removeOutput,
  replaceExpr,
  setNetworkTitle,
} from "./edit";
import { parseLadder, parseValueText } from "./parse";
import { printLadder } from "./print";

const parse = (src: string): LadProgram => {
  const r = parseLadder(src);
  if (!r.ok) throw new Error(`${r.error.line}:${r.error.col} ${r.error.message}`);
  return normalizeProgram(r.program);
};
/** Texte d'un programme, sans la ligne « network ». */
const body = (p: LadProgram) =>
  printLadder(p)
    .split("\n")
    .filter((l) => l.startsWith("  "))
    .map((l) => l.trim())
    .join("\n");

const NO = (name: string) => ({
  type: "contact" as const,
  kind: "NO" as const,
  operand: { kind: "global" as const, text: `"${name}"` },
});

describe("printLadder", () => {
  it.each([
    'network "Marche"\n  ( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" & NC "Defaut" -> COIL "KM1"\n',
    'network\n  NO "A" & NO "B" | NO "C" -> COIL "X", SET "Y"\n  NO "D" -> RESET "Y"\n\nnetwork "Deux"\n  NO "E" -> NCOIL %Q0.1\n',
    'network\n  P "Bp" MEM="M_Bp" & CMP #N >= 10 & TON #T PT=T#5S ET=#E -> COIL "X"\n  NO "Dcy" & MOVE IN=1500 OUT="Consigne"\n',
    'network\n  CTUD "C" CD="Bas" R="Raz" PV=10 QD="Vide" CV=#Nb -> COIL "Plein"\n',
  ])("réécrit le texte à l'identique (%#)", (src) => {
    expect(printLadder(parse(src))).toBe(src);
  });

  it("produit un texte que le parseur relit à l'identique", () => {
    const p = parse('NO "A" & ( NO "B" | NO "C" & ( NO "D" | NO "E" ) ) -> COIL "X"');
    expect(parse(printLadder(p))).toEqual(p);
  });
});

describe("opérations d'édition", () => {
  const base = parse('NO "A" & NO "B" -> COIL "X"');
  const refB = { network: 0, rung: 0, path: [1] };

  it("insère en série avant et après", () => {
    expect(body(insertSeries(base, refB, "before", NO("N")))).toBe('NO "A" & NO "N" & NO "B" -> COIL "X"');
    expect(body(insertSeries(base, refB, "after", NO("N")))).toBe('NO "A" & NO "B" & NO "N" -> COIL "X"');
  });

  it("insère en série sur un rung à un seul contact", () => {
    const one = parse('NO "A" -> COIL "X"');
    expect(body(insertSeries(one, { network: 0, rung: 0, path: [] }, "after", NO("B")))).toBe(
      'NO "A" & NO "B" -> COIL "X"',
    );
  });

  it("ajoute une branche parallèle, puis une deuxième au même niveau", () => {
    const once = insertParallel(base, refB, NO("P1"));
    expect(body(once)).toBe('NO "A" & ( NO "B" | NO "P1" ) -> COIL "X"');
    const twice = insertParallel(once, { network: 0, rung: 0, path: [1, 0] }, NO("P2"));
    expect(body(twice)).toBe('NO "A" & ( NO "B" | NO "P2" | NO "P1" ) -> COIL "X"');
  });

  it("supprime et dissout les groupes devenus inutiles", () => {
    const p = parse('NO "A" & ( NO "B" | NO "C" ) -> COIL "X"');
    expect(body(removeExpr(p, { network: 0, rung: 0, path: [1, 1] }))).toBe('NO "A" & NO "B" -> COIL "X"');
  });

  it("supprime le rung puis le réseau quand ils sont vides", () => {
    const p = parse('NO "A" -> COIL "X"\nnetwork\nNO "B" -> COIL "Y"');
    const after = removeExpr(p, { network: 0, rung: 0, path: [] });
    expect(after.networks).toHaveLength(1);
    expect(body(after)).toBe('NO "B" -> COIL "Y"');
  });

  it("remet une bobine si on retire la boîte qui terminait le rung", () => {
    const p = parse('NO "Dcy" & MOVE IN=1 OUT="X"');
    expect(body(removeExpr(p, { network: 0, rung: 0, path: [1] }))).toBe('NO "Dcy" -> COIL "???"');
  });

  it("remplace un élément et retrouve un élément par son adresse", () => {
    const p = replaceExpr(base, refB, { ...NO("B2"), kind: "NC" });
    expect(getExpr(p, refB)).toEqual({ ...NO("B2"), kind: "NC" });
    expect(body(p)).toBe('NO "A" & NC "B2" -> COIL "X"');
  });

  it("ajoute et retire des bobines, sans laisser un rung sans bobine", () => {
    const two = addOutput(base, 0, 0, newOutput("SET"));
    expect(body(two)).toBe('NO "A" & NO "B" -> COIL "X", SET "???"');
    expect(canRemoveOutput(two, { network: 0, rung: 0, output: 1 })).toBe(true);
    expect(body(removeOutput(two, { network: 0, rung: 0, output: 0 }))).toBe('NO "A" & NO "B" -> SET "???"');
    expect(canRemoveOutput(base, { network: 0, rung: 0, output: 0 })).toBe(false);
  });

  it("crée des rungs et des réseaux depuis la palette", () => {
    const empty: LadProgram = { networks: [] };
    const p1 = addRung(empty, 0, { kind: "contact", variant: "NC" });
    expect(printLadder(p1)).toBe('network\n  NC "???" -> COIL "???"\n');
    const p2 = addRung(p1, 0, { kind: "box", box: "MOVE" });
    expect(body(p2)).toBe('NC "???" -> COIL "???"\nMOVE IN=0 OUT="???"');
    const p3 = addRung(p2, 1, { kind: "coil", variant: "SET" });
    expect(p3.networks).toHaveLength(2);
    expect(printLadder(setNetworkTitle(p3, 1, ' Mémo "défaut" '))).toContain(
      'network "Mémo défaut"\n  NO "???" -> SET "???"',
    );
    // Tout ce que produit l'éditeur doit rester lisible par le parseur.
    expect(parseLadder(printLadder(p3)).ok).toBe(true);
  });

  it("crée des éléments par défaut valides pour chaque boîte", () => {
    for (const box of [
      "TON",
      "TOF",
      "TP",
      "TONR",
      "CTU",
      "CTD",
      "CTUD",
      "MOVE",
      "ADD",
      "SUB",
      "MUL",
      "DIV",
    ] as const) {
      const p = addRung({ networks: [] }, 0, { kind: "box", box });
      expect(parseLadder(printLadder(p)).ok, box).toBe(true);
    }
    expect(newElement({ kind: "edge", variant: "P" })).toMatchObject({ type: "edge", kind: "P" });
  });
});

describe("parseValueText", () => {
  it("accepte opérandes et constantes, met entre guillemets un nom nu", () => {
    expect(parseValueText("Moteur", false)).toEqual({
      ok: true,
      value: { kind: "global", text: '"Moteur"' },
    });
    expect(parseValueText(' "DB_Ligne".Marche ', false)).toEqual({
      ok: true,
      value: { kind: "global", text: '"DB_Ligne".Marche' },
    });
    expect(parseValueText("#Tempo.Q", false)).toMatchObject({ ok: true, value: { kind: "local" } });
    expect(parseValueText("%i0.0", false)).toEqual({ ok: true, value: { kind: "absolute", text: "%I0.0" } });
    expect(parseValueText("t#5s", true)).toEqual({ ok: true, value: { kind: "literal", text: "T#5S" } });
  });

  it("refuse le reste avec un message", () => {
    expect(parseValueText("10", false)).toMatchObject({ ok: false });
    expect(parseValueText("A B", true)).toMatchObject({ ok: false });
    expect(parseValueText('"ouvert', true)).toMatchObject({ ok: false });
    expect(parseValueText("", true)).toMatchObject({ ok: false });
  });
});
