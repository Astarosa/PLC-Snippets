/**
 * Arbre syntaxique du DSL LADDER.
 *
 * Un rung (une ligne de schéma) = une condition (contacts en série / parallèle)
 * qui pilote une ou plusieurs sorties (bobines).
 */

/** Opérande tel qu'écrit : "KM1", "DB_Ligne".Marche, #Tempo.Q, %I0.0 */
export interface Operand {
  kind: "global" | "local" | "absolute";
  text: string;
}

export type ContactKind = "NO" | "NC";
export type CoilKind = "COIL" | "NCOIL" | "SET" | "RESET";

export type Expr =
  | { type: "contact"; kind: ContactKind; operand: Operand }
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
