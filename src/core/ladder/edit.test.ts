import { describe, expect, it } from "vitest";
import type { LadProgram } from "./ast";
import {
  addOutput,
  addRung,
  canRemoveOutput,
  findRef,
  getExpr,
  inRange,
  insertParallel,
  insertSeries,
  moveExpr,
  moveOutput,
  newElement,
  newOutput,
  normalizeProgram,
  rangeBetween,
  removeExpr,
  removeNetwork,
  removeOutput,
  removeRange,
  removeRung,
  replaceExpr,
  setNetworkComment,
  setNetworkTitle,
  setRungComment,
  wrapParallel,
} from "./edit";
import { parseLadder, parseValueText, toEditableText } from "./parse";
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
    expect(parseValueText("#a #b", true)).toMatchObject({ ok: false });
    expect(parseValueText("Moteur.", true)).toMatchObject({ ok: false });
    expect(parseValueText('"ouvert', true)).toMatchObject({ ok: false });
    expect(parseValueText("", true)).toMatchObject({ ok: false });
  });
});

describe("commentaires", () => {
  const SRC = `// Commande du moteur principal
// (armoire A2)
network "Moteur" // titre court
  // Auto-maintien
  ( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" -> COIL "KM1" // KM1 = contacteur
  NO "KM1" -> COIL "H1"
// Signalisation
network
  NO "Defaut" -> COIL "H2"
  // commentaire final orphelin`;

  it("rattache chaque commentaire à son réseau ou à son rung", () => {
    const p = parse(SRC);
    expect(p.networks[0].comment).toBe("Commande du moteur principal\n(armoire A2)\ntitre court");
    expect(p.networks[0].rungs[0].comment).toBe("Auto-maintien\nKM1 = contacteur");
    expect(p.networks[0].rungs[1].comment).toBeUndefined();
    expect(p.networks[1].comment).toBe("Signalisation");
    expect(p.networks[1].rungs[0].comment).toBe("commentaire final orphelin");
  });

  it("les réécrit et les retrouve à l'identique après réimpression", () => {
    const p = parse(SRC);
    const printed = printLadder(p);
    expect(printed).toContain(
      '// Commande du moteur principal\n// (armoire A2)\n// titre court\nnetwork "Moteur"',
    );
    expect(printed).toContain('  // Auto-maintien\n  // KM1 = contacteur\n  ( NO "BP_Marche"');
    expect(parse(printed)).toEqual(p);
  });

  it("survivent aux modifications visuelles", () => {
    const p = parse(SRC);
    const edited = insertSeries(p, { network: 0, rung: 0, path: [1] }, "after", NO("Auto"));
    expect(edited.networks[0].rungs[0].comment).toBe("Auto-maintien\nKM1 = contacteur");
    expect(edited.networks[0].comment).toBe("Commande du moteur principal\n(armoire A2)\ntitre court");
  });
});

describe("saisie sans guillemets", () => {
  it.each([
    ["Moteur", '"Moteur"'],
    ["Mot clé", '"Mot clé"'],
    ["DB_Ligne.Marche", '"DB_Ligne".Marche'],
    ["DB_Ligne.Pompe.Etat", '"DB_Ligne".Pompe.Etat'],
    ['"Déjà entre guillemets"', '"Déjà entre guillemets"'],
  ])("lit « %s » comme %s", (input, expected) => {
    expect(parseValueText(input, false)).toEqual({ ok: true, value: { kind: "global", text: expected } });
  });

  it.each([
    ['"Moteur"', "Moteur"],
    ['"Mot clé"', "Mot clé"],
    ['"DB_Ligne".Marche', "DB_Ligne.Marche"],
    ['"???"', "???"],
    ['"Nom.avec.points"', '"Nom.avec.points"'],
    ['"TRUE"', '"TRUE"'],
    ['"10"', '"10"'],
    ['"#pas_local"', '"#pas_local"'],
    ["#Tempo.Q", "#Tempo.Q"],
    ["%I0.0", "%I0.0"],
    ["T#5S", "T#5S"],
  ])("affiche %s comme « %s », et la relecture redonne l'original", (stored, shown) => {
    expect(toEditableText(stored)).toBe(shown);
    const back = parseValueText(shown, true);
    expect(back.ok && back.value.text).toBe(stored);
  });
});

describe("déplacer des éléments posés", () => {
  it("déplace un contact plus loin dans la série", () => {
    const p = parse('NO "A" & NO "B" & NO "C" -> COIL "X"');
    const a = getExpr(p, { network: 0, rung: 0, path: [0] });
    if (!a) throw new Error();
    const { program, moved } = moveExpr(p, a, (prog, copy) =>
      insertSeries(prog, { network: 0, rung: 0, path: [2] }, "after", copy),
    );
    expect(body(program)).toBe('NO "B" & NO "C" & NO "A" -> COIL "X"');
    expect(findRef(program, moved)).toEqual({ kind: "expr", network: 0, rung: 0, path: [2] });
  });

  it("déplace un contact dans une branche parallèle d'un autre rung", () => {
    const p = parse('NO "A" & NO "B" -> COIL "X"\nNO "C" -> COIL "Y"');
    const b = getExpr(p, { network: 0, rung: 0, path: [1] });
    if (!b) throw new Error();
    const { program } = moveExpr(p, b, (prog, copy) =>
      insertParallel(prog, { network: 0, rung: 1, path: [] }, copy),
    );
    expect(body(program)).toBe('NO "A" -> COIL "X"\nNO "C" | NO "B" -> COIL "Y"');
  });

  it("garde les bobines quand on déplace le seul contact d'un rung", () => {
    const p = parse('NO "A" -> COIL "X"\nNO "C" -> COIL "Y"');
    const a = getExpr(p, { network: 0, rung: 0, path: [] });
    if (!a) throw new Error();
    const { program } = moveExpr(p, a, (prog, copy) =>
      insertSeries(prog, { network: 0, rung: 1, path: [] }, "before", copy),
    );
    expect(body(program)).toBe('NO "???" -> COIL "X"\nNO "A" & NO "C" -> COIL "Y"');
  });

  it("déplace une bobine vers un autre rung", () => {
    const p = parse('NO "A" -> COIL "X", SET "M"\nNO "C" -> COIL "Y"');
    const m = p.networks[0].rungs[0].outputs[1];
    const { program } = moveOutput(p, m, 0, 1);
    expect(body(program)).toBe('NO "A" -> COIL "X"\nNO "C" -> COIL "Y", SET "M"');
  });
});

describe("plages et branches parallèles", () => {
  const p = parse('NO "A" & NO "B" & ( NO "C" | NO "D" ) & NO "E" -> COIL "X"');
  const ref = (path: number[]) => ({ network: 0, rung: 0, path });

  it("calcule la plage entre deux éléments d'une même série", () => {
    expect(rangeBetween(p, ref([0]), ref([1]))).toEqual({ network: 0, rung: 0, parent: [], from: 0, to: 1 });
    expect(rangeBetween(p, ref([3]), ref([1]))).toEqual({ network: 0, rung: 0, parent: [], from: 1, to: 3 });
    // Un contact dans une parallèle et un contact dehors : la plage englobe tout le groupe.
    expect(rangeBetween(p, ref([2, 1]), ref([3]))).toEqual({
      network: 0,
      rung: 0,
      parent: [],
      from: 2,
      to: 3,
    });
    // Deux branches de la même parallèle : le groupe entier.
    expect(rangeBetween(p, ref([2, 0]), ref([2, 1]))).toEqual({
      network: 0,
      rung: 0,
      parent: [],
      from: 2,
      to: 2,
    });
    expect(rangeBetween(p, ref([0]), { network: 0, rung: 1, path: [0] })).toBeNull();
  });

  it("sait si un élément est dans la plage", () => {
    const range = { network: 0, rung: 0, parent: [], from: 1, to: 2 };
    expect([[0], [1], [2, 0], [2, 1], [3]].map((path) => inRange(range, 0, 0, path))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it("crée une branche parallèle autour de plusieurs contacts", () => {
    const range = rangeBetween(p, ref([0]), ref([1]));
    if (!range) throw new Error();
    expect(body(wrapParallel(p, range, NO("Bypass")))).toBe(
      '( NO "A" & NO "B" | NO "Bypass" ) & ( NO "C" | NO "D" ) & NO "E" -> COIL "X"',
    );
  });

  it("crée une branche parallèle autour de tout le rung", () => {
    const one = parse('NO "A" & NO "B" -> COIL "X"');
    const range = rangeBetween(one, ref([0]), ref([1]));
    if (!range) throw new Error();
    expect(body(wrapParallel(one, range, NO("C")))).toBe('NO "A" & NO "B" | NO "C" -> COIL "X"');
  });

  it("supprime une plage", () => {
    const range = rangeBetween(p, ref([1]), ref([2, 0]));
    if (!range) throw new Error();
    expect(body(removeRange(p, range))).toBe('NO "A" & NO "E" -> COIL "X"');
  });
});

describe("rungs, réseaux et commentaires", () => {
  const p = parse('NO "A" -> COIL "X"\nNO "B" -> COIL "Y"\nnetwork "Deux"\nNO "C" -> COIL "Z"');

  it("supprime un rung, puis un réseau", () => {
    expect(body(removeRung(p, 0, 0))).toBe('NO "B" -> COIL "Y"\nNO "C" -> COIL "Z"');
    expect(removeNetwork(p, 0).networks.map((n) => n.title)).toEqual(["Deux"]);
  });

  it("modifie et efface les commentaires", () => {
    const c = setRungComment(setNetworkComment(p, 1, "Signalisation\n\n"), 0, 1, "lampe H1");
    expect(printLadder(c)).toContain('  // lampe H1\n  NO "B"');
    expect(printLadder(c)).toContain('// Signalisation\nnetwork "Deux"');
    expect(printLadder(setNetworkComment(c, 1, "  \n"))).not.toContain("Signalisation");
  });
});
