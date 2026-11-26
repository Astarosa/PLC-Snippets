import { describe, expect, it } from "vitest";
import { parseLadder } from "./parse";
import {
  emptySimState,
  flowKey,
  operandKey,
  parseDuration,
  parseLiteral,
  type SimState,
  scan,
  simVariables,
} from "./simulate";

const program = (src: string) => {
  const r = parseLadder(src);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.program;
};
const set = (s: SimState, entries: Record<string, boolean | number>) => {
  for (const [k, v] of Object.entries(entries)) s.values.set(operandKey(k), v);
};
const get = (s: SimState, k: string) => s.values.get(operandKey(k));

describe("simulation LADDER", () => {
  it("auto-maintien : marche, maintien, arrêt", () => {
    const p = program('( NO "Marche" | NO "KM" ) & NO "Arret" -> COIL "KM"');
    const s = emptySimState();
    set(s, { '"Arret"': true });
    scan(p, s, 0);
    expect(get(s, '"KM"')).toBe(false);
    set(s, { '"Marche"': true });
    scan(p, s, 10);
    set(s, { '"Marche"': false });
    scan(p, s, 20);
    expect(get(s, '"KM"')).toBe(true);
    set(s, { '"Arret"': false });
    scan(p, s, 30);
    expect(get(s, '"KM"')).toBe(false);
  });

  it("note le courant dans chaque élément (branche parallèle comprise)", () => {
    const p = program('( NO "A" | NO "B" ) & NC "C" -> COIL "Q"');
    const s = emptySimState();
    set(s, { '"B"': true });
    const [flow] = scan(p, s, 0);
    expect(flow.get(flowKey(0, [0, 0]))).toEqual({ in: true, out: false });
    expect(flow.get(flowKey(0, [0, 1]))).toEqual({ in: true, out: true });
    expect(flow.get(flowKey(0, [1]))).toEqual({ in: true, out: true });
    expect(flow.get("0:o0")).toEqual({ in: true, out: true });
  });

  it("SET / RESET et bobine inversée", () => {
    const p = program('NO "D" -> SET "Al"\nNO "Acq" & NC "D" -> RESET "Al"\nNO "Al" -> NCOIL "Ok"');
    const s = emptySimState();
    set(s, { '"D"': true });
    scan(p, s, 0);
    set(s, { '"D"': false });
    scan(p, s, 1);
    expect(get(s, '"Al"')).toBe(true);
    expect(get(s, '"Ok"')).toBe(false);
    set(s, { '"Acq"': true });
    scan(p, s, 2);
    expect(get(s, '"Al"')).toBe(false);
    expect(get(s, '"Ok"')).toBe(true);
  });

  it("TON : sortie après PT, ET qui monte, remise à zéro quand IN retombe", () => {
    const p = program('NO "C" & TON "T" PT=T#3S ET="Ecoule" -> COIL "S"\nNO "T".Q -> COIL "Copie"');
    const s = emptySimState();
    set(s, { '"C"': true });
    scan(p, s, 1000);
    scan(p, s, 3000);
    expect(get(s, '"S"')).toBe(false);
    expect(get(s, '"Ecoule"')).toBe(2000);
    scan(p, s, 4000);
    expect(get(s, '"S"')).toBe(true);
    expect(get(s, '"Copie"')).toBe(true);
    set(s, { '"C"': false });
    scan(p, s, 4100);
    expect(get(s, '"S"')).toBe(false);
    expect(get(s, '"T".ET')).toBe(0);
  });

  it("TOF et TP", () => {
    const tof = program('NO "C" & TOF #T PT=T#1S -> COIL "S"');
    const s = emptySimState();
    scan(tof, s, 0);
    expect(get(s, '"S"')).toBe(false);
    set(s, { '"C"': true });
    scan(tof, s, 100);
    set(s, { '"C"': false });
    scan(tof, s, 200);
    scan(tof, s, 1100);
    expect(get(s, '"S"')).toBe(true);
    scan(tof, s, 1300);
    expect(get(s, '"S"')).toBe(false);

    const tp = program('NO "C" & TP #P PT=T#500MS -> COIL "S"');
    const t = emptySimState();
    set(t, { '"C"': true });
    scan(tp, t, 0);
    set(t, { '"C"': false });
    scan(tp, t, 100);
    expect(get(t, '"S"')).toBe(true);
    scan(tp, t, 600);
    expect(get(t, '"S"')).toBe(false);
  });

  it("comptage sur front montant avec remise à zéro", () => {
    const p = program('P "Cap" MEM="M_F" & CTU "C" R="Raz" PV=3 CV="Nb" -> COIL "Lot"');
    const s = emptySimState();
    for (let i = 0; i < 3; i++) {
      set(s, { '"Cap"': true });
      scan(p, s, i * 2);
      scan(p, s, i * 2); // capteur maintenu : un seul comptage
      set(s, { '"Cap"': false });
      scan(p, s, i * 2 + 1);
    }
    expect(get(s, '"Nb"')).toBe(3);
    // CTU : Q suit CV ≥ PV, mais le rung n'a de courant qu'au front montant.
    expect(get(s, '"C".Q')).toBe(true);
    set(s, { '"Raz"': true });
    scan(p, s, 10);
    expect(get(s, '"Nb"')).toBe(0);
  });

  it("comparateurs, MOVE et calculs", () => {
    const p = program(
      'CMP "Niveau" >= 80 -> COIL "Haut"\nNO "Go" & MOVE IN=1500 OUT="Consigne"\nNO "Go" & ADD IN1="Consigne" IN2=16#10 OUT="Total"\nNO "Go" & DIV IN1=7 IN2=2 OUT="Moitie"',
    );
    const s = emptySimState();
    set(s, { '"Niveau"': 85, '"Go"': true });
    scan(p, s, 0);
    expect(get(s, '"Haut"')).toBe(true);
    expect(get(s, '"Consigne"')).toBe(1500);
    expect(get(s, '"Total"')).toBe(1516);
    expect(get(s, '"Moitie"')).toBe(3);
  });

  it("variables du pupitre : entrées forçables, sorties calculées", () => {
    const vars = simVariables(
      program('NO "A" & TON "T" PT=T#1S -> COIL "Q"\nNO "T".Q & CMP "N" > 2 -> SET "M"'),
    );
    const byKey = Object.fromEntries(vars.map((v) => [v.key, [v.kind, v.written]]));
    expect(byKey).toEqual({
      '"A"': ["bool", false],
      '"Q"': ["bool", true],
      '"T".Q': ["bool", true],
      '"N"': ["number", false],
      '"M"': ["bool", true],
      '"T".ET': ["number", true],
    });
  });

  it("constantes et durées", () => {
    expect(parseDuration("T#1M30S")).toBe(90_000);
    expect(parseDuration("t#500ms")).toBe(500);
    expect(parseDuration("T#2.5S")).toBe(2500);
    expect(parseLiteral("16#FF")).toBe(255);
    expect(parseLiteral("INT#-5")).toBe(-5);
    expect(parseLiteral("TRUE")).toBe(true);
    expect(parseLiteral("1.5E2")).toBe(150);
    expect(parseLiteral('"X"')).toBeNull();
  });
});
