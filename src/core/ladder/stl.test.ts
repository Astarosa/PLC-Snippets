import { describe, expect, it } from "vitest";
import type { SnippetInterface } from "../snippet/schema";
import { parseLadder } from "./parse";
import { ladderToStl, type StlContext } from "./stl";

const iface = (partial: Partial<SnippetInterface> = {}): SnippetInterface => ({
  input: [],
  output: [],
  inOut: [],
  static: [],
  temp: [],
  constant: [],
  ...partial,
});

function stl(source: string, ctx: Partial<StlContext> = {}) {
  const parsed = parseLadder(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const r = ladderToStl(parsed.program, { mnemonic: "DE", ...ctx });
  if (!r.ok) throw new Error(r.error);
  return { code: r.stl.trim().split("\n"), warnings: r.warnings };
}

describe("ladderToStl", () => {
  it("auto-maintien : branche parallèle, série, contact NF", () => {
    const { code } = stl('( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" & NC "Defaut" -> COIL "KM1"');
    expect(code).toEqual([
      "U(",
      'O     "BP_Marche"',
      'O     "KM1"',
      ")",
      'U     "BP_Arret"',
      'UN    "Defaut"',
      '=     "KM1"',
    ]);
  });

  it("branche de plusieurs contacts dans un OU", () => {
    const { code } = stl('NO "A" | NO "B" & NC "C" -> COIL "Q"');
    expect(code).toEqual(["U(", 'O     "A"', "O(", 'U     "B"', 'UN    "C"', ")", ")", '=     "Q"']);
  });

  it("plusieurs bobines, Set / Reset, bobine inverse", () => {
    const { code } = stl('NO "A" -> COIL "Q1", SET "Q2", RESET "Q3", NCOIL "Q4"');
    expect(code).toEqual(['U     "A"', '=     "Q1"', 'S     "Q2"', 'R     "Q3"', "NOT", '=     "Q4"', "NOT"]);
  });

  it("front montant : détection sur l'opérande seul", () => {
    const { code } = stl('NO "Marche" & P "Capteur" MEM="M_Front" -> COIL "Impulsion"');
    expect(code).toEqual([
      'U     "Marche"',
      "U(",
      'U     "Capteur"',
      'FP    "M_Front"',
      ")",
      '=     "Impulsion"',
    ]);
  });

  it("comparateur typé par l'interface ou la table des variables API", () => {
    const local = stl("CMP #Niveau >= 100 -> COIL #Haut", {
      iface: iface({ input: [{ name: "Niveau", type: "Real" }] }),
    });
    expect(local.code.slice(0, 5)).toEqual(["U(", "L     #Niveau", "L     100", ">=R", ")"]);
    const global = stl('CMP "Compte" == "Consigne" -> COIL "Egal"', {
      plcTags: [{ name: "Consigne", type: "DInt" }],
    });
    expect(global.code).toContain("==D");
    expect(global.warnings).toEqual([]);
  });

  it("signale un type inconnu au lieu de le taire", () => {
    const { code, warnings } = stl('CMP "Niveau" > 10 -> COIL "Haut"');
    expect(code).toContain(">I");
    expect(warnings[0]).toMatch(/"Niveau" inconnu, entier 16 bits \(I\) supposé/);
  });

  it("TON avec DB d'instance : RLO sur IN, CALL, puis le fil repart de Q", () => {
    const { code } = stl('NO "Marche" & TON "T_Defaut" PT=T#5S ET="Ecoule" -> COIL "Defaut"');
    expect(code).toEqual([
      'U     "Marche"',
      '=     "T_Defaut".IN',
      'CALL  TON , "T_Defaut"',
      "{time_type := 'Time'}",
      "(",
      "   PT := T#5S,",
      '   ET => "Ecoule"',
      ");",
      'U     "T_Defaut".Q',
      '=     "Defaut"',
    ]);
  });

  it("compteur en multi-instance, type pris dans l'interface", () => {
    const { code, warnings } = stl('P "Capteur" MEM=#mem & CTU #cLot R="Raz" PV=50 CV=#nb -> COIL "Plein"', {
      iface: iface({
        static: [
          { name: "cLot", type: "CTU_DINT" },
          { name: "mem", type: "Bool" },
          { name: "nb", type: "DInt" },
        ],
      }),
    });
    expect(code).toContain("=     #cLot.CU");
    expect(code).toContain("CALL  #cLot");
    expect(code).toContain("{value_type := 'DInt'}");
    expect(code).toContain("U     #cLot.Q");
    expect(warnings).toEqual([]);
  });

  it("boîte en début de rung : RLO forcé à 1", () => {
    const { code } = stl('TON #t PT=T#1S -> COIL "Q"', {
      iface: iface({ static: [{ name: "t", type: "TON_TIME" }] }),
    });
    expect(code.slice(0, 2)).toEqual(["SET", "=     #t.IN"]);
  });

  it("MOVE conditionnel : saut si EN = 0, sans suite", () => {
    const { code } = stl('NO "Raz" & MOVE IN=0 OUT="Compteur"');
    expect(code).toEqual(['U     "Raz"', "SPBNB M001", "L     0", 'T     "Compteur"', "M001: NOP 0"]);
  });

  it("calcul suivi d'une bobine : ENO = EN repris par le bit BIE", () => {
    const { code } = stl('NO "Go" & ADD IN1=#a IN2=1 OUT=#b -> COIL "Fait"', {
      iface: iface({
        static: [
          { name: "a", type: "Int" },
          { name: "b", type: "Int" },
        ],
      }),
    });
    expect(code).toEqual([
      'U     "Go"',
      "SPBNB M001",
      "L     #a",
      "L     1",
      "+I",
      "T     #b",
      "M001: U     BIE",
      '=     "Fait"',
    ]);
  });

  it("MOVE sans condition puis bobine : RLO remis à 1", () => {
    const { code } = stl('MOVE IN=5 OUT=#x -> COIL "Q"', {
      iface: iface({ static: [{ name: "x", type: "Int" }] }),
    });
    expect(code).toEqual(["L     5", "T     #x", "SET", '=     "Q"']);
  });

  it("réseaux, titres et commentaires", () => {
    const { code } = stl(
      ['network "Marche"', "  // Démarrage", '  NO "A" -> COIL "B"', "network", '  NO "C" -> COIL "D"'].join(
        "\n",
      ),
    );
    expect(code).toEqual([
      "NETWORK",
      "TITLE = Marche",
      "// Démarrage",
      'U     "A"',
      '=     "B"',
      "",
      "NETWORK",
      "TITLE =",
      'U     "C"',
      '=     "D"',
    ]);
  });

  it("produit la mnémonique anglaise", () => {
    const { code } = stl('( NO %I0.0 | NO "KM1" ) & NO "Go" & ADD IN1=#a IN2=1 OUT=#a -> COIL %Q4.0', {
      mnemonic: "EN",
      iface: iface({ static: [{ name: "a", type: "Int" }] }),
    });
    expect(code).toEqual([
      "A(",
      "O     %I0.0",
      'O     "KM1"',
      ")",
      'A     "Go"',
      "JNB   M001",
      "L     #a",
      "L     1",
      "+I",
      "T     #a",
      "M001: A     BR",
      "=     %Q4.0",
    ]);
  });

  it("temporisation dans une branche : appelée avant le rung, sa sortie sert de contact", () => {
    const { code } = stl('NO "A" & ( TON "T" PT=T#1S | NO "B" ) -> COIL "Q"');
    expect(code).toEqual([
      'U     "A"',
      '=     "T".IN',
      'CALL  TON , "T"',
      "{time_type := 'Time'}",
      "(",
      "   PT := T#1S",
      ");",
      'U     "A"',
      "U(",
      'O     "T".Q',
      'O     "B"',
      ")",
      '=     "Q"',
    ]);
  });

  it("branche sans condition avant la boîte : SET sur l'entrée", () => {
    const { code } = stl('NO "A" | NO "B" & CTU "C" PV=3 -> COIL "Q"');
    expect(code.slice(0, 3)).toEqual(['U     "B"', '=     "C".CU', 'CALL  CTU , "C"']);
    expect(code.slice(-8)).toEqual([
      "U(",
      'O     "A"',
      "O(",
      'U     "B"',
      'U     "C".Q',
      ")",
      ")",
      '=     "Q"',
    ]);
    const first = stl('TON "T" PT=T#1S | NO "A" -> COIL "Q"').code;
    expect(first.slice(0, 2)).toEqual(["SET", '=     "T".IN']);
  });

  it("MOVE en parallèle sous une même condition", () => {
    const { code } = stl('NO "Go" & ( MOVE IN=1 OUT="X" | MOVE IN=2 OUT="Y" ) -> COIL "Fait"');
    expect(code).toEqual([
      'U     "Go"',
      "SPBNB M001",
      "L     1",
      'T     "X"',
      "M001: NOP 0",
      'U     "Go"',
      "SPBNB M002",
      "L     2",
      'T     "Y"',
      "M002: NOP 0",
      'U     "Go"',
      '=     "Fait"',
    ]);
    // Avec une bobine : la branche toujours passante ne change pas la condition.
    expect(stl('NO "Go" & ( MOVE IN=1 OUT="X" | NO "B" ) -> COIL "Q"').code.slice(-2)).toEqual([
      'U     "Go"',
      '=     "Q"',
    ]);
  });

  it("refuse une boîte de branche placée après un front, avec une raison claire", () => {
    const parsed = parseLadder('P "A" MEM="M" & ( TON "T" PT=T#1S | NO "B" ) -> COIL "Q"');
    if (!parsed.ok) throw new Error(parsed.error.message);
    const r = ladderToStl(parsed.program, { mnemonic: "DE" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/TON dans une branche parallèle, après un front/);
  });
});
