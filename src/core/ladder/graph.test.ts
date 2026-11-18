import { describe, expect, it } from "vitest";
import type { Expr, LadProgram, Output } from "./ast";
import { normalizeProgram } from "./edit";
import { type FlowGraph, graphsToProgram, graphToNetwork, networkToGraph } from "./graph";
import { parseLadder } from "./parse";
import { printLadder } from "./print";

const parse = (src: string): LadProgram => {
  const r = parseLadder(src);
  if (!r.ok) throw new Error(r.error.message);
  return normalizeProgram(r.program);
};
const roundTrip = (src: string) => {
  const p = parse(src);
  const { program } = graphsToProgram(p.networks.map(networkToGraph));
  return printLadder(normalizeProgram(program));
};

const NO = (n: string): Expr => ({
  type: "contact",
  kind: "NO",
  operand: { kind: "global", text: `"${n}"` },
});
const COIL = (n: string): Output => ({ kind: "COIL", operand: { kind: "global", text: `"${n}"` } });

describe("aller-retour programme → graphe → programme", () => {
  it.each([
    'NO "A" -> COIL "X"',
    'NO "A" & NC "B" & NO "C" -> COIL "X"',
    '( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" & NC "Defaut" -> COIL "KM1"',
    'NO "A" & ( NO "B" | NO "C" ) -> COIL "X"',
    'NO "A" & ( NO "B" & ( NO "C" | NO "D" ) | NO "E" ) & NO "F" -> COIL "X"',
    'NO "A" & NO "B" | NO "C" & NO "D" -> COIL "X", SET "Y", RESET "Z"',
    'P "Bp" MEM="M" & CTU "C" R="Raz" PV=10 CV=#Nb -> COIL "Plein"',
    'NO "Dcy" & MOVE IN=1500 OUT="Consigne"\n  NO "A" -> COIL "B"\n  ADD IN1=#T IN2=1 OUT=#T',
    'CMP "N" >= 80 & ( TON #T PT=T#5S | NO "Forcage" ) -> COIL "Pompe"',
  ])("%s", (src) => {
    expect(roundTrip(src)).toBe(printLadder(parse(src)));
  });

  it("garde titres, commentaires et plusieurs réseaux", () => {
    const src = '// Moteur\nnetwork "M1"\n  NO "A" -> COIL "X"\nnetwork "M2"\n  NO "B" -> COIL "Y"';
    expect(roundTrip(src)).toBe(printLadder(parse(src)));
  });
});

describe("graphes venant d'un autre logiciel", () => {
  it("bobines en série (TIA) : même condition, même rung", () => {
    const g: FlowGraph = {
      title: null,
      nodes: [
        { id: "a", kind: "element", element: NO("A"), sources: [null] },
        { id: "c1", kind: "coil", output: COIL("X"), sources: ["a"] },
        { id: "c2", kind: "coil", output: COIL("Y"), sources: ["c1"] },
      ],
    };
    const { network } = graphToNetwork(g);
    expect(network?.rungs).toHaveLength(2);
    // Les deux rungs ont la même condition « A » (la bobine laisse passer le flux).
    expect(printLadder({ networks: network ? [network] : [] })).toBe(
      'network\n  NO "A" -> COIL "X"\n  NO "A" -> COIL "Y"\n',
    );
  });

  it("éventail vers deux bobines par des chemins différents : deux rungs", () => {
    const g: FlowGraph = {
      title: "T",
      nodes: [
        { id: "a", kind: "element", element: NO("A"), sources: [null] },
        { id: "b", kind: "element", element: NO("B"), sources: ["a"] },
        { id: "x", kind: "coil", output: COIL("X"), sources: ["b"] },
        { id: "y", kind: "coil", output: COIL("Y"), sources: ["a"] },
      ],
    };
    expect(printLadder({ networks: [graphToNetwork(g).network as never] })).toBe(
      'network "T"\n  NO "A" & NO "B" -> COIL "X"\n  NO "A" -> COIL "Y"\n',
    );
  });

  it("signale les éléments non reliés et ignore un réseau vide", () => {
    const g: FlowGraph = {
      title: null,
      nodes: [
        { id: "a", kind: "element", element: NO("A"), sources: [] },
        { id: "x", kind: "coil", output: COIL("X"), sources: ["a"] },
        { id: "b", kind: "element", element: NO("B"), sources: [null] },
      ],
    };
    const r = graphToNetwork(g);
    expect(r.network).toBeNull();
    expect(r.warnings.join("\n")).toContain('Bobine "X" non reliée');
    expect(r.warnings.join("\n")).toContain("Contact non relié à une bobine");
  });

  it("détecte une boucle", () => {
    const g: FlowGraph = {
      title: null,
      nodes: [
        { id: "a", kind: "element", element: NO("A"), sources: ["b"] },
        { id: "b", kind: "element", element: NO("B"), sources: ["a"] },
        { id: "x", kind: "coil", output: COIL("X"), sources: ["b"] },
      ],
    };
    expect(graphToNetwork(g).warnings.join("\n")).toContain("Boucle");
  });
});
