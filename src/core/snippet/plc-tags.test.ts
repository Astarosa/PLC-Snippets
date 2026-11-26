import { describe, expect, it } from "vitest";
import { checkLadderSource, errorsOf, warningsOf } from "../ladder/check";
import { parseLadder } from "../ladder/parse";
import {
  addressProblem,
  assignAddresses,
  formatAddress,
  overlappingTags,
  parseAddress,
  undeclaredGlobals,
  usedGlobals,
} from "./plc-tags";
import type { PlcTag, SnippetInterface } from "./schema";

const program = (src: string) => {
  const r = parseLadder(src);
  if (!r.ok) throw new Error(r.error.message);
  return r.program;
};

const emptyIface: SnippetInterface = { input: [], output: [], inOut: [], static: [], temp: [], constant: [] };

describe("adresses", () => {
  it("lit les adresses internationales et allemandes", () => {
    expect(parseAddress("%I0.0")).toEqual({ area: "I", size: "X", byte: 0, bit: 0 });
    expect(parseAddress("QW2")).toEqual({ area: "Q", size: "W", byte: 2, bit: 0 });
    expect(parseAddress("%E1.3")).toEqual({ area: "I", size: "X", byte: 1, bit: 3 });
    expect(parseAddress("%MD10")).toEqual({ area: "M", size: "D", byte: 10, bit: 0 });
    for (const bad of ["%I0", "%I0.8", "%MW1.0", "X1", ""]) expect(parseAddress(bad)).toBeNull();
  });

  it("écrit l'adresse dans la mnémonique du projet", () => {
    const a = parseAddress("%Q4.1");
    if (!a) throw new Error();
    expect(formatAddress(a)).toBe("%Q4.1");
    expect(formatAddress(a, "DE")).toBe("%A4.1");
  });

  it("vérifie l'accord entre type et taille d'adresse", () => {
    expect(addressProblem({ name: "A", type: "Bool", address: "%I0.0" })).toBeNull();
    expect(addressProblem({ name: "A", type: "Int", address: "%MW10" })).toBeNull();
    expect(addressProblem({ name: "A", type: "Int", address: "%M10.0" })).toMatch(/adresse mot/);
    expect(addressProblem({ name: "A", type: "Bool", address: "%I0" })).toMatch(/invalide/);
    expect(addressProblem({ name: "A", type: "Bool" })).toBeNull();
  });

  it("détecte les chevauchements", () => {
    const tags: PlcTag[] = [
      { name: "Mot", type: "Word", address: "%MW10" },
      { name: "Bit", type: "Bool", address: "%M11.3" },
      { name: "Ailleurs", type: "Bool", address: "%I11.3" },
    ];
    expect(overlappingTags(tags).map(([a, b]) => `${a.name}/${b.name}`)).toEqual(["Mot/Bit"]);
  });

  it("attribue des adresses %M libres sans écraser les existantes", () => {
    const { tags, assigned } = assignAddresses([
      { name: "Occupé", type: "Bool", address: "%M1000.0" },
      { name: "B1", type: "Bool" },
      { name: "B2", type: "Bool" },
      { name: "N", type: "Int" },
      { name: "Udt", type: '"Mon_UDT"' },
    ]);
    expect(assigned.map((t) => `${t.name}=${t.address}`)).toEqual([
      "B1=%M1000.1",
      "B2=%M1000.2",
      "N=%MW1002",
    ]);
    expect(tags.find((t) => t.name === "Udt")?.address).toBeUndefined();
  });
});

describe("variables du LADDER", () => {
  const src = [
    'NO "Convoyeur_Marche" & NC "Capteur_Sortie" & TON "T_Bourrage" PT=T#8S -> SET "Defaut"',
    "network",
    '  P "Capteur_Sortie" MEM="M_Front" & CTU "C_Lot" R="Raz_Lot" PV="Consigne" CV="Nb_Pieces" -> COIL "Lot_Complet"',
    "network",
    '  MOVE IN=2.5 OUT="Vitesse"',
    '  CMP "DB_Ligne".Niveau > 10 -> COIL "Haut"',
  ].join("\n");

  it("liste les variables avec un type déduit, sans les DB d'instance ni les DB par membre", () => {
    const used = Object.fromEntries(usedGlobals(program(src)).map((g) => [g.name, g.type]));
    expect(used).toEqual({
      Convoyeur_Marche: "Bool",
      Capteur_Sortie: "Bool",
      Defaut: "Bool",
      M_Front: "Bool",
      Raz_Lot: "Bool",
      Consigne: "Int",
      Nb_Pieces: "Int",
      Lot_Complet: "Bool",
      Vitesse: "Real",
      Haut: "Bool",
    });
  });

  it("ne propose que les variables pas encore déclarées", () => {
    const missing = undeclaredGlobals(program(src), [{ name: "defaut", type: "Bool" }]);
    expect(missing.map((g) => g.name)).not.toContain("Defaut");
    expect(missing).toHaveLength(9);
  });
});

describe("contrôles de la table", () => {
  const check = (src: string, plcTags: PlcTag[]) =>
    checkLadderSource(src, { blockType: "NETWORK", iface: emptyIface, plcTags });

  it("propose de déclarer les variables manquantes", () => {
    const d = check('NO "A" -> COIL "B"', [{ name: "A", type: "Bool", address: "%I0.0" }]);
    const w = warningsOf(d).find((x) => x.fix === "declare-tags");
    expect(w?.message).toMatch(/"B"/);
  });

  it("vérifie le type des variables déclarées et refuse une instance en variable API", () => {
    const d = check('NO "Niveau" & TON "T1" PT=T#1S -> COIL "B"', [
      { name: "Niveau", type: "Int", address: "%IW0" },
      { name: "T1", type: "Bool", address: "%M0.0" },
      { name: "B", type: "Bool", address: "%Q0.0" },
    ]);
    const text = errorsOf(d)
      .map((x) => x.message)
      .join("\n");
    expect(text).toMatch(/"Niveau" : Int\) : type entier, il faut un Bool/);
    expect(text).toMatch(/"T1" sert d'instance/);
  });

  it("une table complète et cohérente ne lève rien", () => {
    const d = check('( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" -> COIL "KM1"', [
      { name: "BP_Marche", type: "Bool", address: "%I0.0" },
      { name: "BP_Arret", type: "Bool", address: "%I0.1" },
      { name: "KM1", type: "Bool", address: "%Q0.0" },
    ]);
    expect(d).toEqual([]);
  });
});
