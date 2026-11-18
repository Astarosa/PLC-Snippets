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
    ['NO "A" & TON "T" -> COIL "B"', 1, 10, "étape 5"],
    ['FOO "A" -> COIL "B"', 1, 1, "Élément inconnu"],
    ["", 1, 1, "vide"],
    ['NO "A" -> COIL "B"\n  NO "C" & -> COIL "D"', 2, 12, "Contact attendu"],
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

  it("commente les réseaux", () => {
    expect(scl('network "Pompe"\nNO "A" -> COIL "B"\nnetwork\nNO "C" -> COIL "D"')).toBe(
      ["// Réseau 1 : Pompe", '"B" := "A";', "", "// Réseau 2", '"D" := "C";'].join("\n"),
    );
  });
});
