import { describe, expect, it } from "vitest";
import type { BlockType, SnippetInterface } from "../snippet/schema";
import { checkLadderSource, type Diagnostic, errorsOf, warningsOf } from "./check";

const iface = (partial: Partial<SnippetInterface> = {}): SnippetInterface => ({
  input: [],
  output: [],
  inOut: [],
  static: [],
  temp: [],
  constant: [],
  ...partial,
});

const check = (source: string, blockType: BlockType = "FB", i = iface()) =>
  checkLadderSource(source, { blockType, iface: i });
const messages = (d: Diagnostic[]) => d.map((x) => x.message).join("\n");

describe("checkLadder", () => {
  it("accepte un auto-maintien propre", () => {
    const d = check('(NO "Marche" | NO "Moteur") & NC "Arret" -> COIL "Moteur"');
    expect(d).toEqual([]);
  });

  it("refuse les opérandes à compléter et pointe l'élément", () => {
    const d = check('NO "???" -> COIL "Sortie"');
    expect(errorsOf(d)).toHaveLength(1);
    expect(d[0].ref).toEqual({ kind: "expr", network: 0, rung: 0, path: [] });
  });

  it("refuse une boîte sans instance et une bobine à compléter", () => {
    const d = check('NO "A" & TON "???" PT=T#5S -> COIL "???"');
    expect(messages(errorsOf(d))).toMatch(/instance à compléter/);
    expect(errorsOf(d).some((x) => x.ref?.kind === "output")).toBe(true);
  });

  it("détecte un DB d'instance qui porte le nom d'une variable API (cas réel TIA V20)", () => {
    const d = check(
      [
        'network "Remplissage Eau"',
        '  NO "Capteur 2" & NC "Convoyeur" -> COIL "Remplissage Eau"',
        'network "Tempo eau"',
        '  NO "Remplissage Eau" & TON "Remplissage Eau" PT="Dosage Ricard" -> COIL "Ricard Prêt"',
      ].join("\n"),
    );
    expect(messages(errorsOf(d))).toMatch(/à la fois comme instance/);
  });

  it("signale un Reset sans Set et une double affectation", () => {
    const d = check(
      [
        'NO "C1" -> RESET "Bouteille Pleine"',
        "network",
        '  NO "A" -> COIL "X"',
        "network",
        '  NO "B" -> COIL "X"',
      ].join("\n"),
    );
    expect(errorsOf(d)).toEqual([]);
    expect(messages(warningsOf(d))).toMatch(/jamais mise à 1/);
    expect(messages(warningsOf(d))).toMatch(/affectée 2 fois/);
  });

  it("vérifie les variables locales et leurs types", () => {
    const i = iface({
      input: [{ name: "Niveau", type: "Int" }],
      output: [{ name: "Alarme", type: "Bool" }],
      static: [{ name: "tempo", type: "Int" }],
    });
    const d = check("NO #Niveau & NO #Inconnu & TON #tempo PT=10 -> COIL #Alarme", "FB", i);
    const text = messages(errorsOf(d));
    expect(text).toMatch(/#Niveau : Int\) : type entier, il faut un Bool/);
    expect(text).toMatch(/#Inconnu n'est pas déclarée/);
    expect(text).toMatch(/#tempo est de type Int, il faut TON_TIME/);
    expect(text).toMatch(/PT \(10\) : type entier, il faut un durée/);
  });

  it("refuse la multi-instance dans une FC", () => {
    const d = check('NO "A" & TON #t PT=T#1S -> COIL "B"', "FC");
    expect(messages(errorsOf(d))).toMatch(/impossible dans une FC/);
  });

  it("accepte une multi-instance correcte dans un FB", () => {
    const i = iface({ static: [{ name: "t", type: "TON_TIME" }], output: [{ name: "Q", type: "Bool" }] });
    const d = check('NO "A" & TON #t PT=T#1S -> COIL #Q', "FB", i);
    expect(d).toEqual([]);
  });

  it("signale un bit de front en Temp et un bit partagé", () => {
    const i = iface({ temp: [{ name: "m", type: "Bool" }] });
    const d = check('P "A" MEM=#m -> COIL "X"\nnetwork\n  N "B" MEM=#m -> COIL "Y"', "FB", i);
    const text = messages(warningsOf(d));
    expect(text).toMatch(/en Temp/);
    expect(text).toMatch(/sert à 2 fronts/);
  });

  it("refuse l'écriture d'une constante et une division par zéro", () => {
    const i = iface({ constant: [{ name: "SEUIL", type: "Int", initial: "10" }] });
    const d = check('DIV IN1="A" IN2=0 OUT=#SEUIL', "FB", i);
    const text = messages(errorsOf(d));
    expect(text).toMatch(/est une constante/);
    expect(text).toMatch(/division par zéro/);
  });

  it("signale une sortie jamais écrite et une interface en double", () => {
    const i = iface({ input: [{ name: "X", type: "Bool" }], output: [{ name: "x", type: "Bool" }] });
    const d = check('NO #X -> COIL "Y"', "FB", i);
    expect(messages(errorsOf(d))).toMatch(/déclarée deux fois/);
    expect(messages(warningsOf(d))).toMatch(/jamais écrite/);
  });

  it("transforme une erreur de syntaxe en diagnostic bloquant", () => {
    expect(errorsOf(check("NO -> COIL"))).toHaveLength(1);
  });
});
