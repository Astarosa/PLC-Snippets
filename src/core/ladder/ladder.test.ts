import { describe, expect, it } from "vitest";
import type { LadProgram } from "./ast";
import { parseLadder } from "./parse";
import { ladderToScl } from "./scl";

function parse(source: string): LadProgram {
  const result = parseLadder(source);
  if (!result.ok) throw new Error(`${result.error.line}:${result.error.col} ${result.error.message}`);
  return result.program;
}

const scl = (source: string) => ladderToScl(parse(source)).trim();

describe("parseLadder", () => {
  it("lit l'exemple marche / arrêt", () => {
    const program = parse(`network "Marche / arrêt"
      ( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" & NC "Defaut" -> COIL "KM1"`);
    expect(program.networks).toHaveLength(1);
    expect(program.networks[0].title).toBe("Marche / arrêt");
    const [rung] = program.networks[0].rungs;
    expect(rung.condition.type).toBe("series");
    expect(rung.outputs).toEqual([{ kind: "COIL", operand: { kind: "global", text: '"KM1"' } }]);
  });

  it("accepte les constantes en base 16, 2 et typées", () => {
    const program = parse('NO "Go" & ADD IN1=16#FF IN2=2#1010 OUT="A"\nNO "Go" & MOVE IN=INT#10 OUT="B"');
    const params = program.networks[0].rungs.map((r) =>
      r.condition.type === "series" && r.condition.items[1].type === "box" ? r.condition.items[1].params : {},
    );
    expect(params[0].IN1).toEqual({ kind: "literal", text: "16#FF" });
    expect(params[0].IN2).toEqual({ kind: "literal", text: "2#1010" });
    expect(params[1].IN).toEqual({ kind: "literal", text: "INT#10" });
  });

  it("accepte locales, membres de DB, adresses absolues et minuscules", () => {
    const program = parse('no #Tempo.Q & nc "DB_Ligne".Defaut & NO %i0.0 & NO "DB"."Mot clé" -> coil %Q0.1');
    const [rung] = program.networks[0].rungs;
    if (rung.condition.type !== "series") throw new Error();
    expect(rung.condition.items.map((c) => (c.type === "contact" ? c.operand.text : ""))).toEqual([
      "#Tempo.Q",
      '"DB_Ligne".Defaut',
      "%I0.0",
      '"DB"."Mot clé"',
    ]);
    expect(rung.outputs[0].operand).toEqual({ kind: "absolute", text: "%Q0.1" });
  });

  it("gère plusieurs réseaux, plusieurs rungs et les commentaires", () => {
    const program = parse(`// premier réseau sans mot-clé
      NO "A" -> COIL "B"
      NO "C" -> SET "D"   // commentaire en fin de ligne
      network "Deux"
      NO "E" -> RESET "D", COIL "F"`);
    expect(program.networks.map((n) => n.rungs.length)).toEqual([2, 1]);
    expect(program.networks[1].rungs[0].outputs.map((o) => o.kind)).toEqual(["RESET", "COIL"]);
  });

  it.each([
    ['NO "A" COIL "B"', 1, 8, "« -> » attendu"],
    ['NO "A" -> NO "B"', 1, 11, "Bobine attendue"],
    ['NO -> COIL "B"', 1, 4, "Opérande attendu après NO"],
    ['( NO "A" | NO "B" -> COIL "C"', 1, 19, "pour fermer la parenthèse"],
    ['NO "A -> COIL "B"', 1, 17, "Caractère inattendu"],
    ['NO "A" & TON "T" -> COIL "B"', 1, 10, "paramètre PT manquant"],
    ['NO "A" & TON PT=T#5S -> COIL "B"', 1, 14, "instance attendue"],
    ['TON #T PT=T#5S XX=1 -> COIL "B"', 1, 16, "TON n'a pas de paramètre XX"],
    ["MOVE IN=5 OUT=10", 1, 1, "la sortie OUT doit être une variable"],
    ['P "Bp" -> COIL "B"', 1, 1, "bit mémoire de front manquant"],
    ['CMP "N" = 5 -> COIL "B"', 1, 9, "Comparateur attendu"],
    ['NO "A"', 1, 7, "« -> » attendu"],
    ['FOO "A" -> COIL "B"', 1, 1, "Élément inconnu"],
    ["", 1, 1, "vide"],
    ['NO "A" -> COIL "B"\n  NO "C" & -> COIL "D"', 2, 12, "Élément attendu"],
  ])("signale l'erreur dans « %s »", (source, line, col, message) => {
    const result = parseLadder(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain(message);
      expect([result.error.line, result.error.col]).toEqual([line, col]);
    }
  });
});

describe("ladderToScl", () => {
  it("génère l'auto-maintien de l'exemple", () => {
    expect(scl('( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" & NC "Defaut" -> COIL "KM1"')).toBe(
      '"KM1" := ("BP_Marche" OR "KM1") AND "BP_Arret" AND NOT "Defaut";',
    );
  });

  it("respecte la priorité AND / OR", () => {
    expect(scl('NO "A" & NO "B" | NO "C" -> COIL "X"')).toBe('"X" := "A" AND "B" OR "C";');
    expect(scl('NO "A" & ( NO "B" | NO "C" & NO "D" ) -> COIL "X"')).toBe(
      '"X" := "A" AND ("B" OR "C" AND "D");',
    );
  });

  it("traduit NCOIL", () => {
    expect(scl('NO "A" -> NCOIL "X"')).toBe('"X" := NOT "A";');
    expect(scl('NO "A" & NO "B" -> NCOIL "X"')).toBe('"X" := NOT ("A" AND "B");');
  });

  it("traduit SET / RESET sans ELSE", () => {
    expect(scl('NO "Dcy" -> SET "Cycle"')).toBe('IF "Dcy" THEN\n    "Cycle" := TRUE;\nEND_IF;');
    expect(scl('NO "Fin" -> RESET "Cycle"')).toBe('IF "Fin" THEN\n    "Cycle" := FALSE;\nEND_IF;');
  });

  it("évalue la condition une seule fois quand il y a plusieurs sorties", () => {
    expect(scl('( NO "M" | NO "KM1" ) & NO "A" -> COIL "KM1", COIL "H1", SET "Memo"')).toBe(
      [
        'IF ("M" OR "KM1") AND "A" THEN',
        '    "KM1" := TRUE;',
        '    "H1" := TRUE;',
        '    "Memo" := TRUE;',
        "ELSE",
        '    "KM1" := FALSE;',
        '    "H1" := FALSE;',
        "END_IF;",
      ].join("\n"),
    );
  });

  it("appelle une temporisation multi-instance et continue avec Q", () => {
    expect(scl('NO "Capteur" & NC "Raz" & TON #Tempo PT=T#5S ET=#Ecoule -> COIL "Defaut"')).toBe(
      ['#Tempo(IN := "Capteur" AND NOT "Raz", PT := T#5S, ET => #Ecoule);', '"Defaut" := #Tempo.Q;'].join(
        "\n",
      ),
    );
  });

  it("appelle une temporisation dans un DB d'instance", () => {
    expect(scl('NO "Dcy" & TOF "T_Arret" PT=T#2S -> COIL "KM2"')).toBe(
      ['"T_Arret".TOF(IN := "Dcy", PT := T#2S);', '"KM2" := "T_Arret".Q;'].join("\n"),
    );
  });

  it("continue le fil après la boîte (contacts en série après Q)", () => {
    expect(scl('( NO "A" | NO "B" ) & TON #T PT=T#1S & NO "C" -> COIL "X"')).toBe(
      ['#T(IN := "A" OR "B", PT := T#1S);', '"X" := #T.Q AND "C";'].join("\n"),
    );
  });

  it("gère un compteur avec remise à zéro et valeur courante", () => {
    expect(scl('P "Piece" MEM="Mem_Piece" & CTU #Cpt R="Raz" PV=100 CV=#Nb -> COIL "Lot_Plein"')).toBe(
      [
        '#Cpt(CU := "Piece" AND NOT "Mem_Piece", R := "Raz", PV := 100, CV => #Nb);',
        '"Lot_Plein" := #Cpt.Q;',
        '"Mem_Piece" := "Piece"; // mémoire du front montant',
      ].join("\n"),
    );
  });

  it("gère CTUD et sa sortie QU", () => {
    expect(scl('NO "Haut" & CTUD #C CD="Bas" PV=10 QD="Vide" -> COIL "Plein"')).toBe(
      ['#C(CU := "Haut", CD := "Bas", PV := 10, QD => "Vide");', '"Plein" := #C.QU;'].join("\n"),
    );
  });

  it("traduit un front descendant", () => {
    expect(scl('N "Porte" MEM="M_Porte" -> SET "Alarme"')).toBe(
      [
        'IF NOT "Porte" AND "M_Porte" THEN',
        '    "Alarme" := TRUE;',
        "END_IF;",
        '"M_Porte" := "Porte"; // mémoire du front descendant',
      ].join("\n"),
    );
  });

  it("traduit les comparateurs avec les bonnes parenthèses", () => {
    expect(scl('CMP "Niveau" >= 80 -> COIL "Plein"')).toBe('"Plein" := "Niveau" >= 80;');
    expect(scl('NO "Auto" & CMP "Temp" > 25.5 -> COIL "Ventil"')).toBe(
      '"Ventil" := "Auto" AND ("Temp" > 25.5);',
    );
    expect(scl('CMP #Etape == 10 | NO "Forcage" -> COIL "V1"')).toBe('"V1" := (#Etape = 10) OR "Forcage";');
  });

  it("exécute MOVE et les calculs sous condition, ou toujours s'ils sont sur la barre", () => {
    expect(scl('P "Bp" MEM="M_Bp" & MOVE IN=1500 OUT="Consigne"')).toBe(
      [
        'IF "Bp" AND NOT "M_Bp" THEN',
        '    "Consigne" := 1500;',
        "END_IF;",
        '"M_Bp" := "Bp"; // mémoire du front montant',
      ].join("\n"),
    );
    expect(scl("ADD IN1=#Total IN2=1 OUT=#Total")).toBe("#Total := #Total + 1;");
    expect(scl('NO "Calc" & DIV IN1=#Somme IN2=#Nb OUT=#Moyenne -> COIL "Fait"')).toBe(
      ['IF "Calc" THEN', "    #Moyenne := #Somme / #Nb;", "END_IF;", '"Fait" := "Calc";'].join("\n"),
    );
  });

  it("donne à chaque branche parallèle le même fil entrant", () => {
    expect(scl('NO "A" & ( TON #T1 PT=T#1S | NO "B" ) -> COIL "X"')).toBe(
      ['#T1(IN := "A", PT := T#1S);', '"X" := #T1.Q OR "A" AND "B";'].join("\n"),
    );
  });

  it("commente les réseaux", () => {
    expect(scl('network "Pompe"\nNO "A" -> COIL "B"\nnetwork\nNO "C" -> COIL "D"')).toBe(
      ["// Réseau 1 : Pompe", '"B" := "A";', "", "// Réseau 2", '"D" := "C";'].join("\n"),
    );
  });
});

describe("commentaires dans le SCL généré", () => {
  it("reprend les commentaires de réseau et de rung", () => {
    expect(
      scl(
        '// Pompe de relevage\nnetwork "Pompe"\n  // marche si niveau haut\n  NO "Niveau_Haut" -> COIL "Pompe"',
      ),
    ).toBe(
      [
        "// Réseau 1 : Pompe",
        "// Pompe de relevage",
        "// marche si niveau haut",
        '"Pompe" := "Niveau_Haut";',
      ].join("\n"),
    );
  });
});
