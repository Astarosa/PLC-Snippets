import { BOX_SPECS, type Expr, type LadProgram, type Rung } from "./ast";

/*
 * Écriture d'un programme LADDER en texte DSL (l'inverse du parseur).
 * Utilisé par l'éditeur visuel : chaque modification de l'arbre réécrit le texte
 * dans un format standard. parseLadder(printLadder(p)) redonne p.
 */

export function printExpr(expr: Expr, parent: "root" | "series" | "parallel" = "root"): string {
  switch (expr.type) {
    case "contact":
      return `${expr.kind} ${expr.operand.text}`;
    case "edge":
      return `${expr.kind} ${expr.operand.text} MEM=${expr.memory.text}`;
    case "compare":
      return `CMP ${expr.left.text} ${expr.op} ${expr.right.text}`;
    case "box": {
      const spec = BOX_SPECS[expr.box];
      const params = [...spec.inputs, ...spec.outputs]
        .filter((name) => expr.params[name])
        .map((name) => `${name}=${expr.params[name].text}`);
      return [expr.box, expr.instance?.text, ...params].filter(Boolean).join(" ");
    }
    case "series":
      return expr.items.map((e) => printExpr(e, "series")).join(" & ");
    case "parallel": {
      const text = expr.branches.map((e) => printExpr(e, "parallel")).join(" | ");
      // & est prioritaire sur | : une parallèle dans une série doit être parenthésée.
      return parent === "series" ? `( ${text} )` : text;
    }
  }
}

export function printRung(rung: Rung): string {
  const condition = printExpr(rung.condition);
  if (rung.outputs.length === 0) return condition;
  return `${condition} -> ${rung.outputs.map((o) => `${o.kind} ${o.operand.text}`).join(", ")}`;
}

const commentLines = (comment: string | undefined, indent: string) =>
  comment === undefined ? [] : comment.split("\n").map((l) => `${indent}// ${l}`.trimEnd());

export function printLadder(program: LadProgram): string {
  if (program.networks.length === 0) return "";
  const blocks = program.networks.map((network) => {
    const header = network.title !== null ? `network "${network.title}"` : "network";
    return [
      ...commentLines(network.comment, ""),
      header,
      ...network.rungs.flatMap((r) => [...commentLines(r.comment, "  "), `  ${printRung(r)}`]),
    ].join("\n");
  });
  return `${blocks.join("\n\n")}\n`;
}
