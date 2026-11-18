import { BOX_SPECS, type BoxKind, type CoilKind, type Expr, type LadProgram, type Output } from "./ast";

/*
 * Opérations d'édition de l'éditeur visuel, sur l'arbre LADDER.
 * Toutes sont pures : elles renvoient un nouveau programme, normalisé
 * (séries et parallèles imbriquées aplaties, groupes d'un seul élément dissous).
 */

/** Adresse d'un élément de condition : réseau, rung, puis indices dans l'arbre. */
export interface ExprRef {
  network: number;
  rung: number;
  path: number[];
}

/** Adresse d'une bobine. */
export interface OutputRef {
  network: number;
  rung: number;
  output: number;
}

export type ElementRef = ({ kind: "expr" } & ExprRef) | ({ kind: "output" } & OutputRef);

/** Élément qu'on peut déposer depuis la palette. */
export type PaletteItem =
  | { kind: "contact"; variant: "NO" | "NC" }
  | { kind: "edge"; variant: "P" | "N" }
  | { kind: "compare" }
  | { kind: "box"; box: BoxKind }
  | { kind: "coil"; variant: CoilKind };

/** Opérande à compléter : visible dans le schéma et valide pour le parseur. */
export const PLACEHOLDER = '"???"';

export function newElement(item: Exclude<PaletteItem, { kind: "coil" }>): Expr {
  const op = { kind: "global" as const, text: PLACEHOLDER };
  switch (item.kind) {
    case "contact":
      return { type: "contact", kind: item.variant, operand: op };
    case "edge":
      return {
        type: "edge",
        kind: item.variant,
        operand: op,
        memory: { kind: "global", text: '"M_Front_???"' },
      };
    case "compare":
      return { type: "compare", op: "==", left: op, right: { kind: "literal", text: "0" } };
    case "box": {
      const spec = BOX_SPECS[item.box];
      const defaults: Record<string, string> = {
        PT: "T#1S",
        PV: "10",
        IN: "0",
        IN1: PLACEHOLDER,
        IN2: "1",
        OUT: PLACEHOLDER,
      };
      const params = Object.fromEntries(
        spec.required.map((name) => {
          const text = defaults[name] ?? PLACEHOLDER;
          const kind = text.startsWith('"') ? ("global" as const) : ("literal" as const);
          return [name, { kind, text }];
        }),
      );
      return { type: "box", box: item.box, instance: spec.instance ? op : null, params };
    }
  }
}

export const newOutput = (kind: CoilKind): Output => ({
  kind,
  operand: { kind: "global", text: PLACEHOLDER },
});

/* ---------- Normalisation ---------- */

function normalize(expr: Expr): Expr {
  if (expr.type === "series") {
    const items = expr.items.map(normalize).flatMap((e) => (e.type === "series" ? e.items : [e]));
    return items.length === 1 ? items[0] : { type: "series", items };
  }
  if (expr.type === "parallel") {
    const branches = expr.branches.map(normalize).flatMap((e) => (e.type === "parallel" ? e.branches : [e]));
    return branches.length === 1 ? branches[0] : { type: "parallel", branches };
  }
  return expr;
}

function endsWithBox(expr: Expr): boolean {
  if (expr.type === "box") return true;
  return expr.type === "series" && endsWithBox(expr.items[expr.items.length - 1]);
}

export function normalizeProgram(program: LadProgram): LadProgram {
  return {
    networks: program.networks.map((n) => ({
      ...n,
      rungs: n.rungs.map((r) => {
        const condition = normalize(r.condition);
        // Un rung sans bobine n'est valide que s'il finit par une boîte.
        const outputs = r.outputs.length === 0 && !endsWithBox(condition) ? [newOutput("COIL")] : r.outputs;
        return { ...r, condition, outputs };
      }),
    })),
  };
}

/* ---------- Navigation ---------- */

function children(expr: Expr): Expr[] | null {
  if (expr.type === "series") return expr.items;
  if (expr.type === "parallel") return expr.branches;
  return null;
}

export function getExpr(program: LadProgram, ref: ExprRef): Expr | null {
  let expr: Expr | undefined = program.networks[ref.network]?.rungs[ref.rung]?.condition;
  for (const i of ref.path) {
    const list: Expr[] | null = expr ? children(expr) : null;
    expr = list?.[i];
  }
  return expr ?? null;
}

/** Remplace le sous-arbre à `path` par le résultat de `fn` (null = suppression). */
function updateAt(expr: Expr, path: number[], fn: (e: Expr) => Expr | null): Expr | null {
  if (path.length === 0) return fn(expr);
  const list = children(expr);
  if (!list) return expr;
  const [i, ...rest] = path;
  const updated = list
    .map((child, j) => (j === i ? updateAt(child, rest, fn) : child))
    .filter((e): e is Expr => e !== null);
  if (updated.length === 0) return null;
  return expr.type === "series"
    ? { type: "series", items: updated }
    : { type: "parallel", branches: updated };
}

function mapRung(
  program: LadProgram,
  network: number,
  rung: number,
  fn: (r: LadProgram["networks"][0]["rungs"][0]) => LadProgram["networks"][0]["rungs"][0] | null,
): LadProgram {
  const networks = program.networks
    .map((n, ni) => {
      if (ni !== network) return n;
      const rungs = n.rungs.map((r, ri) => (ri === rung ? fn(r) : r)).filter((r) => r !== null);
      return { ...n, rungs };
    })
    .filter((n) => n.rungs.length > 0);
  return normalizeProgram({ networks });
}

function updateExpr(program: LadProgram, ref: ExprRef, fn: (e: Expr) => Expr | null): LadProgram {
  return mapRung(program, ref.network, ref.rung, (rung) => {
    const condition = updateAt(rung.condition, ref.path, fn);
    return condition ? { ...rung, condition } : null;
  });
}

/* ---------- Opérations ---------- */

/** Insère `element` en série, avant ou après l'élément visé. */
export function insertSeries(
  program: LadProgram,
  ref: ExprRef,
  side: "before" | "after",
  element: Expr,
): LadProgram {
  return updateExpr(program, ref, (target) => ({
    type: "series",
    items: side === "before" ? [element, target] : [target, element],
  }));
}

/** Ajoute `element` en parallèle (branche sous l'élément visé). */
export function insertParallel(program: LadProgram, ref: ExprRef, element: Expr): LadProgram {
  return updateExpr(program, ref, (target) => ({ type: "parallel", branches: [target, element] }));
}

export function replaceExpr(program: LadProgram, ref: ExprRef, element: Expr): LadProgram {
  return updateExpr(program, ref, () => element);
}

/** Supprime un élément ; un rung vidé disparaît, un réseau vidé aussi. */
export function removeExpr(program: LadProgram, ref: ExprRef): LadProgram {
  return updateExpr(program, ref, () => null);
}

export function addOutput(program: LadProgram, network: number, rung: number, output: Output): LadProgram {
  return mapRung(program, network, rung, (r) => ({ ...r, outputs: [...r.outputs, output] }));
}

export function replaceOutput(program: LadProgram, ref: OutputRef, output: Output): LadProgram {
  return mapRung(program, ref.network, ref.rung, (r) => ({
    ...r,
    outputs: r.outputs.map((o, i) => (i === ref.output ? output : o)),
  }));
}

export function removeOutput(program: LadProgram, ref: OutputRef): LadProgram {
  return mapRung(program, ref.network, ref.rung, (r) => ({
    ...r,
    outputs: r.outputs.filter((_, i) => i !== ref.output),
  }));
}

/** Nouveau rung à la fin d'un réseau (network = longueur → nouveau réseau). */
export function addRung(program: LadProgram, network: number, item: PaletteItem): LadProgram {
  // Un rung commence par une condition : une bobine seule reçoit un contact NO à compléter.
  const condition = item.kind === "coil" ? newElement({ kind: "contact", variant: "NO" }) : newElement(item);
  const outputs =
    item.kind === "coil" ? [newOutput(item.variant)] : item.kind === "box" ? [] : [newOutput("COIL")];
  const rung = { condition, outputs };
  if (network >= program.networks.length) {
    return { networks: [...program.networks, { title: null, rungs: [rung] }] };
  }
  return {
    networks: program.networks.map((n, i) => (i === network ? { ...n, rungs: [...n.rungs, rung] } : n)),
  };
}

export function setNetworkTitle(program: LadProgram, network: number, title: string): LadProgram {
  const clean = title.replace(/"/g, "").trim();
  return {
    networks: program.networks.map((n, i) => (i === network ? { ...n, title: clean || null } : n)),
  };
}

/**
 * Une bobine retirée d'un rung qui ne finit pas par une boîte le rendrait invalide :
 * on interdit de supprimer sa dernière bobine.
 */
export function canRemoveOutput(program: LadProgram, ref: OutputRef): boolean {
  const rung = program.networks[ref.network]?.rungs[ref.rung];
  if (!rung) return false;
  if (rung.outputs.length > 1) return true;
  return endsWithBox(rung.condition);
}
