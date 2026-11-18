import type { Expr, LadProgram, Output, Rung } from "./ast";

/*
 * Génération du SCL équivalent à un programme LADDER.
 *
 * - Un rung à une seule bobine COIL devient une affectation lisible :
 *     "KM1" := ("BP_Marche" OR "KM1") AND "BP_Arret";
 * - Dès qu'il y a plusieurs sorties, ou des SET / RESET, on passe par un IF :
 *   la condition n'est évaluée qu'une fois, comme en LADDER (le RLO est commun
 *   à toutes les bobines du rung, même si l'une d'elles modifie un contact).
 */

export function exprToScl(expr: Expr, parent: "root" | "series" | "parallel" = "root"): string {
  switch (expr.type) {
    case "contact":
      return expr.kind === "NC" ? `NOT ${expr.operand.text}` : expr.operand.text;
    case "series": {
      const text = expr.items.map((e) => exprToScl(e, "series")).join(" AND ");
      return text;
    }
    case "parallel": {
      const text = expr.branches.map((e) => exprToScl(e, "parallel")).join(" OR ");
      // Un OU dans un ET doit être parenthésé (AND est prioritaire sur OR).
      return parent === "series" ? `(${text})` : text;
    }
  }
}

function singleAssignment(rung: Rung, output: Output, condition: string): string | null {
  if (output.kind === "COIL") return `${output.operand.text} := ${condition};`;
  if (output.kind === "NCOIL") {
    const negated = rung.condition.type === "contact" ? `NOT ${condition}` : `NOT (${condition})`;
    return `${output.operand.text} := ${negated};`;
  }
  return null;
}

function rungToScl(rung: Rung): string {
  const condition = exprToScl(rung.condition);
  if (rung.outputs.length === 1) {
    const simple = singleAssignment(rung, rung.outputs[0], condition);
    if (simple) return simple;
  }

  const whenTrue: string[] = [];
  const whenFalse: string[] = [];
  for (const { kind, operand } of rung.outputs) {
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
  return `IF ${condition} THEN\n${indent(whenTrue)}${elseBlock}\nEND_IF;`;
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
