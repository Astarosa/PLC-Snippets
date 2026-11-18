import {
  BOX_SPECS,
  type CoilKind,
  type CompareOp,
  type ContactKind,
  type EdgeKind,
  type Expr,
  type Network,
  type Rung,
} from "./ast";

/*
 * Mise en page d'un réseau LADDER sur une grille, indépendante de React :
 * on calcule des formes (fils, contacts, bobines, textes) en pixels, que le
 * composant SVG n'a plus qu'à dessiner. Testable sans navigateur.
 *
 * - série    : les éléments se suivent sur le même fil, largeur = somme
 * - parallèle: les branches s'empilent, hauteur = somme, reliées à gauche et à droite
 */

export const CELL_W = 120;
export const ROW_H = 76;
/** Hauteur du fil dans une ligne (le libellé de l'opérande est au-dessus). */
export const WIRE_Y = 38;
export const RAIL_X = 16;
export const TITLE_H = 28;
const RUNG_GAP = 16;

/** Adresse de l'élément dessiné, pour la sélection et le dépôt dans l'éditeur visuel. */
export interface ShapeRef {
  rung: number;
  /** Chemin dans la condition (contacts, boîtes…). */
  path?: number[];
  /** Index de la bobine. */
  output?: number;
}

export type Shape =
  | { kind: "wire"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "rail"; x: number; y1: number; y2: number }
  | { kind: "contact"; x: number; y: number; variant: ContactKind; label: string; ref?: ShapeRef }
  | { kind: "coil"; x: number; y: number; variant: CoilKind; label: string; ref?: ShapeRef }
  | { kind: "edge"; x: number; y: number; variant: EdgeKind; label: string; memory: string; ref?: ShapeRef }
  | { kind: "compare"; x: number; y: number; op: CompareOp; left: string; right: string; ref?: ShapeRef }
  | {
      kind: "box";
      x: number;
      y: number;
      width: number;
      title: string;
      instance: string | null;
      mainIn: string;
      mainOut: string;
      params: { name: string; value: string; direction: "in" | "out" }[];
      ref?: ShapeRef;
    }
  | { kind: "title"; x: number; y: number; text: string };

export interface RungFrame {
  index: number;
  top: number;
  height: number;
  /** Ordonnée du fil principal du rung. */
  wireY: number;
}

export interface Diagram {
  width: number;
  height: number;
  shapes: Shape[];
  rungs: RungFrame[];
  /** Abscisse de la colonne des bobines. */
  coilX: number;
}

/* Géométrie d'une boîte, relative au fil qui la traverse. */
export const BOX_CELLS = 2;
export const BOX_TOP = 26; // le cadre commence 26 px au-dessus du fil
export const BOX_PARAM_Y = 20; // 1er paramètre 20 px sous le fil
export const BOX_PARAM_H = 16;

function boxParams(expr: Extract<Expr, { type: "box" }>) {
  const spec = BOX_SPECS[expr.box];
  return [
    ...spec.inputs
      .filter((n) => expr.params[n])
      .map((n) => ({ name: n, value: expr.params[n].text, direction: "in" as const })),
    ...spec.outputs
      .filter((n) => expr.params[n])
      .map((n) => ({ name: n, value: expr.params[n].text, direction: "out" as const })),
  ];
}

/** Bas du cadre d'une boîte, relatif au fil. */
export const boxBottom = (paramCount: number) => BOX_PARAM_Y + paramCount * BOX_PARAM_H - 4;

/** Taille d'une expression en cellules (largeur) et en lignes (hauteur). */
function size(expr: Expr): { w: number; h: number } {
  switch (expr.type) {
    case "contact":
    case "edge":
    case "compare":
      return { w: 1, h: 1 };
    case "box":
      return { w: BOX_CELLS, h: Math.ceil((WIRE_Y + boxBottom(boxParams(expr).length) + 4) / ROW_H) };
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
function place(
  expr: Expr,
  col: number,
  row: number,
  originY: number,
  out: Shape[],
  path: number[] = [],
  rung = 0,
) {
  const before = out.length;
  placeShapes(expr, col, row, originY, out, path, rung);
  // Les éléments simples (contacts, boîtes…) reçoivent leur adresse.
  if (expr.type !== "series" && expr.type !== "parallel") {
    const shape = out[before] as Shape & { ref?: ShapeRef };
    shape.ref = { rung, path };
  }
}

function placeShapes(
  expr: Expr,
  col: number,
  row: number,
  originY: number,
  out: Shape[],
  path: number[],
  rung: number,
) {
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
    case "edge":
      out.push({
        kind: "edge",
        x: px(col),
        y: wireY(originY, row),
        variant: expr.kind,
        label: expr.operand.text,
        memory: expr.memory.text,
      });
      return;
    case "compare":
      out.push({
        kind: "compare",
        x: px(col),
        y: wireY(originY, row),
        op: expr.op,
        left: expr.left.text,
        right: expr.right.text,
      });
      return;
    case "box": {
      const spec = BOX_SPECS[expr.box];
      out.push({
        kind: "box",
        x: px(col),
        y: wireY(originY, row),
        width: BOX_CELLS * CELL_W,
        title: expr.box,
        instance: expr.instance?.text ?? null,
        mainIn: spec.mainIn,
        mainOut: spec.mainOut,
        params: boxParams(expr),
      });
      return;
    }
    case "series": {
      let c = col;
      for (const [i, item] of expr.items.entries()) {
        place(item, c, row, originY, out, [...path, i], rung);
        c += size(item).w;
      }
      return;
    }
    case "parallel": {
      const { w } = size(expr);
      let r = row;
      let lastRow = row;
      for (const [i, branch] of expr.branches.entries()) {
        const s = size(branch);
        place(branch, col, r, originY, out, [...path, i], rung);
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

function placeRung(rung: Rung, index: number, originY: number, coilCol: number, out: Shape[]): number {
  const cond = size(rung.condition);
  place(rung.condition, 0, 0, originY, out, [], index);

  // Fil entre la fin de la condition et la colonne des bobines (s'il y en a).
  const y0 = wireY(originY, 0);
  if (rung.outputs.length > 0 && cond.w < coilCol)
    out.push({ kind: "wire", x1: px(cond.w), y1: y0, x2: px(coilCol), y2: y0 });

  // Plusieurs bobines : branches parallèles à droite, comme dans TIA Portal.
  rung.outputs.forEach((o, i) => {
    out.push({
      kind: "coil",
      x: px(coilCol),
      y: wireY(originY, i),
      variant: o.kind,
      label: o.operand.text,
      ref: { rung: index, output: i },
    });
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
  const hasCoils = network.rungs.some((r) => r.outputs.length > 0);
  const rungs: RungFrame[] = [];
  network.rungs.forEach((rung, i) => {
    if (i > 0) y += RUNG_GAP;
    const height = placeRung(rung, i, y, coilCol, shapes);
    rungs.push({ index: i, top: y, height, wireY: wireY(y, 0) });
    y += height;
  });
  const lastCol = hasCoils ? coilCol + 1 : coilCol - 1;
  return { width: px(lastCol) + RAIL_X, height: y + 8, shapes, rungs, coilX: px(coilCol) };
}
