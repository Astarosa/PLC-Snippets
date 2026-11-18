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

/* ---------- Recherche par identité ---------- */

/** Adresse d'un élément (contact, boîte… ou bobine) retrouvé par identité d'objet. */
export function findRef(program: LadProgram, target: Expr | Output): ElementRef | null {
  for (const [n, network] of program.networks.entries()) {
    for (const [r, rung] of network.rungs.entries()) {
      const o = rung.outputs.indexOf(target as Output);
      if (o >= 0) return { kind: "output", network: n, rung: r, output: o };
      const search = (e: Expr, path: number[]): number[] | null => {
        if (e === target) return path;
        for (const [i, child] of (children(e) ?? []).entries()) {
          const found = search(child, [...path, i]);
          if (found) return found;
        }
        return null;
      };
      const path = search(rung.condition, []);
      if (path) return { kind: "expr", network: n, rung: r, path };
    }
  }
  return null;
}

/* ---------- Déplacement ---------- */

/**
 * Déplace un élément déjà posé : `insert` le pose (copie) à sa nouvelle place,
 * puis l'original est retiré. S'il était seul dans son rung, il est remplacé par
 * un contact à compléter, pour ne pas perdre les bobines du rung.
 */
export function moveExpr(
  program: LadProgram,
  element: Expr,
  insert: (program: LadProgram, copy: Expr) => LadProgram,
): { program: LadProgram; moved: Expr } {
  const copy = structuredClone(element);
  const placed = insert(program, copy);
  const original = findRef(placed, element);
  if (original?.kind !== "expr") return { program: placed, moved: copy };
  const alone = original.path.length === 0;
  const next = alone
    ? replaceExpr(placed, original, newElement({ kind: "contact", variant: "NO" }))
    : removeExpr(placed, original);
  return { program: next, moved: copy };
}

/** Déplace une bobine vers un autre rung (ou le même). */
export function moveOutput(
  program: LadProgram,
  output: Output,
  network: number,
  rung: number,
): { program: LadProgram; moved: Output } {
  const copy = structuredClone(output);
  const placed = addOutput(program, network, rung, copy);
  const original = findRef(placed, output);
  if (original?.kind !== "output") return { program: placed, moved: copy };
  // Un rung qui perd sa seule bobine en reçoit une à compléter (normalisation).
  return { program: removeOutput(placed, original), moved: copy };
}

/* ---------- Plages (sélection de plusieurs éléments en série) ---------- */

/** Éléments consécutifs [from..to] d'une série située à `parent` dans la condition. */
export interface RangeRef {
  network: number;
  rung: number;
  parent: number[];
  from: number;
  to: number;
}

function exprAt(root: Expr, path: number[]): Expr | null {
  let e: Expr | undefined = root;
  for (const i of path) e = e ? children(e)?.[i] : undefined;
  return e ?? null;
}

/**
 * Plage qui va de l'élément `a` à l'élément `b` (Maj + clic) : les enfants consécutifs
 * de la série la plus profonde qui les contient tous les deux. null si impossible
 * (éléments dans deux rungs, ou dans deux branches d'une parallèle sans série commune).
 */
export function rangeBetween(program: LadProgram, a: ExprRef, b: ExprRef): RangeRef | null {
  if (a.network !== b.network || a.rung !== b.rung) return null;
  const root = program.networks[a.network]?.rungs[a.rung]?.condition;
  if (!root) return null;
  let common = 0;
  while (common < a.path.length && common < b.path.length && a.path[common] === b.path[common]) common++;
  for (let k = common; k >= 0; k--) {
    const node = exprAt(root, a.path.slice(0, k));
    if (node?.type === "series" && a.path.length > k && b.path.length > k) {
      return {
        network: a.network,
        rung: a.rung,
        parent: a.path.slice(0, k),
        from: Math.min(a.path[k], b.path[k]),
        to: Math.max(a.path[k], b.path[k]),
      };
    }
  }
  return null;
}

/** Le chemin d'un élément est-il dans la plage ? */
export function inRange(range: RangeRef, network: number, rung: number, path: number[]): boolean {
  if (range.network !== network || range.rung !== rung || path.length <= range.parent.length) return false;
  if (range.parent.some((v, i) => path[i] !== v)) return false;
  const i = path[range.parent.length];
  return i >= range.from && i <= range.to;
}

function updateSeriesAt(program: LadProgram, range: RangeRef, fn: (items: Expr[]) => Expr[]): LadProgram {
  return updateExpr(program, { network: range.network, rung: range.rung, path: range.parent }, (node) => {
    if (node.type !== "series") return node;
    const items = fn(node.items);
    return items.length === 0 ? null : { type: "series", items };
  });
}

/** Branche parallèle autour de la plage : (éléments de la plage) | element. */
export function wrapParallel(program: LadProgram, range: RangeRef, element: Expr): LadProgram {
  return updateSeriesAt(program, range, (items) => {
    const selected = items.slice(range.from, range.to + 1);
    const branch: Expr = selected.length === 1 ? selected[0] : { type: "series", items: selected };
    return [
      ...items.slice(0, range.from),
      { type: "parallel", branches: [branch, element] },
      ...items.slice(range.to + 1),
    ];
  });
}

export function removeRange(program: LadProgram, range: RangeRef): LadProgram {
  return updateSeriesAt(program, range, (items) => [
    ...items.slice(0, range.from),
    ...items.slice(range.to + 1),
  ]);
}

/* ---------- Rungs, réseaux, commentaires ---------- */

export function removeRung(program: LadProgram, network: number, rung: number): LadProgram {
  return mapRung(program, network, rung, () => null);
}

export function removeNetwork(program: LadProgram, network: number): LadProgram {
  return { networks: program.networks.filter((_, i) => i !== network) };
}

const cleanComment = (text: string) => {
  const lines = text.split("\n").map((l) => l.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines.join("\n") : undefined;
};

export function setNetworkComment(program: LadProgram, network: number, text: string): LadProgram {
  return {
    networks: program.networks.map((n, i) => (i === network ? { ...n, comment: cleanComment(text) } : n)),
  };
}

export function setRungComment(program: LadProgram, network: number, rung: number, text: string): LadProgram {
  return mapRung(program, network, rung, (r) => ({ ...r, comment: cleanComment(text) }));
}

/** Ajoute un rung (déjà construit) à la fin d'un réseau ; network = longueur → nouveau réseau. */
export function appendRung(
  program: LadProgram,
  network: number,
  rung: LadProgram["networks"][0]["rungs"][0],
): LadProgram {
  if (network >= program.networks.length) {
    return normalizeProgram({ networks: [...program.networks, { title: null, rungs: [rung] }] });
  }
  return normalizeProgram({
    networks: program.networks.map((n, i) => (i === network ? { ...n, rungs: [...n.rungs, rung] } : n)),
  });
}
