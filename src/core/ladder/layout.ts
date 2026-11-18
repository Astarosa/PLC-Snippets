import type { CoilKind, ContactKind, Expr, Network, Rung } from "./ast";

/*
 * Mise en page d'un réseau LADDER sur une grille, indépendante de React :
 * on calcule des formes (fils, contacts, bobines, textes) en pixels, que le
 * composant SVG n'a plus qu'à dessiner. Testable sans navigateur.
 *
 * - série    : les éléments se suivent sur le même fil, largeur = somme
 * - parallèle: les branches s'empilent, hauteur = somme, reliées à gauche et à droite
 */

export const CELL_W = 120;
export const ROW_H = 64;
/** Hauteur du fil dans une ligne (le libellé de l'opérande est au-dessus). */
export const WIRE_Y = 38;
export const RAIL_X = 16;
export const TITLE_H = 28;
const RUNG_GAP = 16;

export type Shape =
  | { kind: "wire"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "rail"; x: number; y1: number; y2: number }
  | { kind: "contact"; x: number; y: number; variant: ContactKind; label: string }
  | { kind: "coil"; x: number; y: number; variant: CoilKind; label: string }
  | { kind: "title"; x: number; y: number; text: string };

export interface Diagram {
  width: number;
  height: number;
  shapes: Shape[];
}

/** Taille d'une expression en cellules (largeur) et en lignes (hauteur). */
function size(expr: Expr): { w: number; h: number } {
  switch (expr.type) {
    case "contact":
      return { w: 1, h: 1 };
    case "series": {
      const sizes = expr.items.map(size);
      return { w: sizes.reduce((s, x) => s + x.w, 0), h: Math.max(...sizes.map((x) => x.h)) };
    }
    case "parallel": {
      const sizes = expr.branches.map(size);
      return { w: Math.max(...sizes.map((x) => x.w)), h: sizes.reduce((s, x) => s + x.h, 0) };
    }
  }
}

const px = (col: number) => RAIL_X + col * CELL_W;
const wireY = (originY: number, row: number) => originY + row * ROW_H + WIRE_Y;

/** Place une expression en (col, row) ; le fil d'entrée et de sortie est sur la ligne `row`. */
function place(expr: Expr, col: number, row: number, originY: number, out: Shape[]) {
  switch (expr.type) {
    case "contact":
      out.push({
        kind: "contact",
        x: px(col),
        y: wireY(originY, row),
        variant: expr.kind,
        label: expr.operand.text,
      });
      return;
    case "series": {
      let c = col;
      for (const item of expr.items) {
        place(item, c, row, originY, out);
        c += size(item).w;
      }
      return;
    }
    case "parallel": {
      const { w } = size(expr);
      let r = row;
      let lastRow = row;
      for (const branch of expr.branches) {
        const s = size(branch);
        place(branch, col, r, originY, out);
        // Branche plus courte : on prolonge le fil jusqu'à la sortie du bloc parallèle.
        if (s.w < w)
          out.push({
            kind: "wire",
            x1: px(col + s.w),
            y1: wireY(originY, r),
            x2: px(col + w),
            y2: wireY(originY, r),
          });
        lastRow = r;
        r += s.h;
      }
      const y1 = wireY(originY, row);
      const y2 = wireY(originY, lastRow);
      out.push({ kind: "wire", x1: px(col), y1, x2: px(col), y2 });
      out.push({ kind: "wire", x1: px(col + w), y1, x2: px(col + w), y2 });
      return;
    }
  }
}

/** Colonnes occupées par la condition la plus large d'un réseau (pour aligner les bobines). */
const conditionWidth = (rung: Rung) => size(rung.condition).w;

function placeRung(rung: Rung, originY: number, coilCol: number, out: Shape[]): number {
  const cond = size(rung.condition);
  place(rung.condition, 0, 0, originY, out);

  // Fil entre la fin de la condition et la colonne des bobines.
  const y0 = wireY(originY, 0);
  if (cond.w < coilCol) out.push({ kind: "wire", x1: px(cond.w), y1: y0, x2: px(coilCol), y2: y0 });

  // Plusieurs bobines : branches parallèles à droite, comme dans TIA Portal.
  rung.outputs.forEach((o, i) => {
    out.push({ kind: "coil", x: px(coilCol), y: wireY(originY, i), variant: o.kind, label: o.operand.text });
  });
  if (rung.outputs.length > 1) {
    out.push({
      kind: "wire",
      x1: px(coilCol),
      y1: y0,
      x2: px(coilCol),
      y2: wireY(originY, rung.outputs.length - 1),
    });
  }

  const rows = Math.max(cond.h, rung.outputs.length);
  out.push({ kind: "rail", x: RAIL_X, y1: originY + 8, y2: originY + rows * ROW_H });
  return rows * ROW_H;
}

export function layoutNetwork(network: Network): Diagram {
  const shapes: Shape[] = [];
  let y = 0;
  if (network.title) {
    shapes.push({ kind: "title", x: RAIL_X, y: 18, text: network.title });
    y = TITLE_H;
  }
  // Toutes les bobines d'un réseau sur la même colonne, au moins 1 cellule après la condition.
  const coilCol = Math.max(2, ...network.rungs.map(conditionWidth)) + 1;
  network.rungs.forEach((rung, i) => {
    if (i > 0) y += RUNG_GAP;
    y += placeRung(rung, y, coilCol, shapes);
  });
  return { width: px(coilCol + 1) + RAIL_X, height: y + 8, shapes };
}
