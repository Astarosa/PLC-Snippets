/**
 * Arbre syntaxique du DSL LADDER.
 *
 * Un rung (une ligne de schéma) = une condition (contacts, boîtes, en série / parallèle)
 * qui pilote zéro, une ou plusieurs sorties (bobines). Zéro bobine n'est permis
 * que si le rung se termine par une boîte (MOVE, ADD, TON…).
 */

/** Opérande tel qu'écrit : "KM1", "DB_Ligne".Marche, #Tempo.Q, %I0.0 */
export interface Operand {
  kind: "global" | "local" | "absolute";
  text: string;
}

/** Valeur d'un paramètre : un opérande ou une constante (T#5S, 10, 16#FF, TRUE). */
export type Value = Operand | { kind: "literal"; text: string };

export type ContactKind = "NO" | "NC";
export type EdgeKind = "P" | "N";
export type CoilKind = "COIL" | "NCOIL" | "SET" | "RESET";
export type CompareOp = "==" | "<>" | ">" | "<" | ">=" | "<=";

export type BoxKind =
  | "TON"
  | "TOF"
  | "TP"
  | "TONR"
  | "CTU"
  | "CTD"
  | "CTUD"
  | "MOVE"
  | "ADD"
  | "SUB"
  | "MUL"
  | "DIV";

export interface BoxSpec {
  /** Instance (DB ou multi-instance) obligatoire : temporisations et compteurs. */
  instance: boolean;
  /** Broche d'entrée reliée au fil (RLO entrant). */
  mainIn: string;
  /** Broche de sortie qui continue le fil. */
  mainOut: string;
  inputs: string[];
  outputs: string[];
  required: string[];
}

const timer = (inputs: string[]): BoxSpec => ({
  instance: true,
  mainIn: "IN",
  mainOut: "Q",
  inputs,
  outputs: ["ET"],
  required: ["PT"],
});
const math: BoxSpec = {
  instance: false,
  mainIn: "EN",
  mainOut: "ENO",
  inputs: ["IN1", "IN2"],
  outputs: ["OUT"],
  required: ["IN1", "IN2", "OUT"],
};

export const BOX_SPECS: Record<BoxKind, BoxSpec> = {
  TON: timer(["PT"]),
  TOF: timer(["PT"]),
  TP: timer(["PT"]),
  TONR: timer(["R", "PT"]),
  CTU: { instance: true, mainIn: "CU", mainOut: "Q", inputs: ["R", "PV"], outputs: ["CV"], required: ["PV"] },
  CTD: {
    instance: true,
    mainIn: "CD",
    mainOut: "Q",
    inputs: ["LD", "PV"],
    outputs: ["CV"],
    required: ["PV"],
  },
  CTUD: {
    instance: true,
    mainIn: "CU",
    mainOut: "QU",
    inputs: ["CD", "R", "LD", "PV"],
    outputs: ["QD", "CV"],
    required: ["PV"],
  },
  MOVE: {
    instance: false,
    mainIn: "EN",
    mainOut: "ENO",
    inputs: ["IN"],
    outputs: ["OUT"],
    required: ["IN", "OUT"],
  },
  ADD: math,
  SUB: math,
  MUL: math,
  DIV: math,
};

export type Expr =
  | { type: "contact"; kind: ContactKind; operand: Operand }
  | { type: "edge"; kind: EdgeKind; operand: Operand; memory: Operand }
  | { type: "compare"; op: CompareOp; left: Value; right: Value }
  | { type: "box"; box: BoxKind; instance: Operand | null; params: Record<string, Value> }
  | { type: "series"; items: Expr[] }
  | { type: "parallel"; branches: Expr[] };

export interface Output {
  kind: CoilKind;
  operand: Operand;
}

export interface Rung {
  condition: Expr;
  outputs: Output[];
}

export interface Network {
  title: string | null;
  rungs: Rung[];
}

export interface LadProgram {
  networks: Network[];
}

export interface LadError {
  message: string;
  line: number;
  col: number;
}
