import {
  BOX_SPECS,
  type Expr,
  type LadProgram,
  type Operand,
  type Output,
  type Rung,
  type Value,
} from "./ast";

/*
 * Génération du SCL équivalent à un programme LADDER.
 *
 * Le RLO (résultat logique) circule de gauche à droite :
 * - les contacts se combinent en expressions booléennes (AND / OR) ;
 * - une boîte reçoit le RLO qui arrive sur sa broche d'entrée (IN, CU, EN…) :
 *     • temporisation / compteur : appel d'instance avant le rung, le fil continue avec #T.Q ;
 *     • MOVE / calcul : exécuté si EN est vrai (IF … THEN), le fil continue avec ENO (= EN) ;
 * - un front P / N compare l'opérande à son bit mémoire, mis à jour après le rung.
 *
 * Sorties :
 * - une seule bobine COIL → affectation lisible : "KM1" := ("BP_Marche" OR "KM1") AND "BP_Arret";
 * - plusieurs sorties ou SET / RESET → IF … ELSE : la condition n'est évaluée qu'une fois,
 *   comme en LADDER (le RLO est commun à toutes les bobines du rung).
 */

/** Expression SCL avec sa priorité, pour ne mettre que les parenthèses utiles. */
interface SclExpr {
  text: string;
  prec: "or" | "and" | "cmp" | "atom";
}

const atom = (text: string): SclExpr => ({ text, prec: "atom" });

function and(a: SclExpr | null, b: SclExpr): SclExpr {
  if (!a) return b;
  const wrap = (e: SclExpr) => (e.prec === "or" || e.prec === "cmp" ? `(${e.text})` : e.text);
  return { text: `${wrap(a)} AND ${wrap(b)}`, prec: "and" };
}

function or(branches: SclExpr[]): SclExpr {
  if (branches.length === 1) return branches[0];
  const wrap = (e: SclExpr) => (e.prec === "cmp" ? `(${e.text})` : e.text);
  return { text: branches.map(wrap).join(" OR "), prec: "or" };
}

const not = (e: SclExpr): string => (e.prec === "atom" ? `NOT ${e.text}` : `NOT (${e.text})`);

const valueText = (v: Value) => v.text;

const CMP_SCL: Record<string, string> = { "==": "=", "<>": "<>", ">": ">", "<": "<", ">=": ">=", "<=": "<=" };
const MATH_SCL: Record<string, string> = { ADD: "+", SUB: "-", MUL: "*", DIV: "/" };

/** Instructions générées pour un rung : avant (appels de boîtes) et après (bits de front). */
interface RungCode {
  before: string[];
  after: string[];
}

function containsSpecial(expr: Expr): boolean {
  switch (expr.type) {
    case "box":
    case "edge":
      return true;
    case "series":
      return expr.items.some(containsSpecial);
    case "parallel":
      return expr.branches.some(containsSpecial);
    default:
      return false;
  }
}

/** Expression purement combinatoire (contacts, comparateurs), sans RLO entrant. */
function pure(expr: Expr): SclExpr {
  switch (expr.type) {
    case "contact":
      return atom(expr.kind === "NC" ? `NOT ${expr.operand.text}` : expr.operand.text);
    case "compare":
      return { text: `${valueText(expr.left)} ${CMP_SCL[expr.op]} ${valueText(expr.right)}`, prec: "cmp" };
    case "series":
      return expr.items.map(pure).reduce<SclExpr | null>((acc, e) => and(acc, e), null) as SclExpr;
    case "parallel":
      return or(expr.branches.map(pure));
    default:
      throw new Error(`pure() appelé sur ${expr.type}`);
  }
}

/**
 * RLO en sortie de `expr`, sachant le RLO qui y entre (`null` = directement sur la barre
 * d'alimentation, donc toujours vrai).
 */
function compile(expr: Expr, incoming: SclExpr | null, code: RungCode): SclExpr | null {
  if (!containsSpecial(expr)) return and(incoming, pure(expr));

  switch (expr.type) {
    case "series": {
      let rlo = incoming;
      for (const item of expr.items) rlo = compile(item, rlo, code);
      return rlo;
    }
    case "parallel": {
      // Chaque branche part du même fil entrant ; une branche réduite au fil = vrai.
      const branches = expr.branches.map((b) => compile(b, incoming, code) ?? atom("TRUE"));
      return or(branches);
    }
    case "edge": {
      const mem = expr.memory.text;
      const op = expr.operand.text;
      code.after.push(`${mem} := ${op}; // mémoire du front ${expr.kind === "P" ? "montant" : "descendant"}`);
      const edge = expr.kind === "P" ? `${op} AND NOT ${mem}` : `NOT ${op} AND ${mem}`;
      return and(incoming, { text: edge, prec: "and" });
    }
    case "box":
      return compileBox(expr, incoming, code);
    default:
      return and(incoming, pure(expr));
  }
}

function compileBox(
  expr: Extract<Expr, { type: "box" }>,
  incoming: SclExpr | null,
  code: RungCode,
): SclExpr | null {
  const spec = BOX_SPECS[expr.box];
  const p = expr.params;

  if (expr.instance) {
    const inst = expr.instance as Operand;
    const args = [`${spec.mainIn} := ${incoming ? incoming.text : "TRUE"}`];
    for (const name of spec.inputs) if (p[name]) args.push(`${name} := ${valueText(p[name])}`);
    for (const name of spec.outputs) if (p[name]) args.push(`${name} => ${valueText(p[name])}`);
    // Multi-instance : #Tempo(...) ; DB d'instance : "T_Defaut".TON(...)
    const callee = inst.kind === "local" ? inst.text : `${inst.text}.${expr.box}`;
    code.before.push(`${callee}(${args.join(", ")});`);
    return atom(`${inst.text}.${spec.mainOut}`);
  }

  const statement =
    expr.box === "MOVE"
      ? `${valueText(p.OUT)} := ${valueText(p.IN)};`
      : `${valueText(p.OUT)} := ${valueText(p.IN1)} ${MATH_SCL[expr.box]} ${valueText(p.IN2)};`;
  code.before.push(incoming ? `IF ${incoming.text} THEN\n    ${statement}\nEND_IF;` : statement);
  // ENO = EN (pas de gestion d'erreur de calcul ici) : le fil continue tel quel.
  return incoming;
}

function outputsToScl(outputs: Output[], rlo: SclExpr): string[] {
  if (outputs.length === 0) return [];
  if (outputs.length === 1) {
    const [o] = outputs;
    if (o.kind === "COIL") return [`${o.operand.text} := ${rlo.text};`];
    if (o.kind === "NCOIL") return [`${o.operand.text} := ${not(rlo)};`];
  }

  const whenTrue: string[] = [];
  const whenFalse: string[] = [];
  for (const { kind, operand } of outputs) {
    if (kind === "COIL") {
      whenTrue.push(`${operand.text} := TRUE;`);
      whenFalse.push(`${operand.text} := FALSE;`);
    } else if (kind === "NCOIL") {
      whenTrue.push(`${operand.text} := FALSE;`);
      whenFalse.push(`${operand.text} := TRUE;`);
    } else if (kind === "SET") {
      whenTrue.push(`${operand.text} := TRUE;`);
    } else {
      whenTrue.push(`${operand.text} := FALSE;`);
    }
  }
  const indent = (lines: string[]) => lines.map((l) => `    ${l}`).join("\n");
  const elseBlock = whenFalse.length > 0 ? `\nELSE\n${indent(whenFalse)}` : "";
  return [`IF ${rlo.text} THEN\n${indent(whenTrue)}${elseBlock}\nEND_IF;`];
}

function rungToScl(rung: Rung): string {
  const code: RungCode = { before: [], after: [] };
  const rlo = compile(rung.condition, null, code) ?? atom("TRUE");
  return [...code.before, ...outputsToScl(rung.outputs, rlo), ...code.after].join("\n");
}

export function ladderToScl(program: LadProgram): string {
  const blocks = program.networks.map((network, i) => {
    const header =
      program.networks.length > 1 || network.title
        ? [`// Réseau ${i + 1}${network.title ? ` : ${network.title}` : ""}`]
        : [];
    return [...header, ...network.rungs.map(rungToScl)].join("\n");
  });
  return `${blocks.join("\n\n")}\n`;
}
