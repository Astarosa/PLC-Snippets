import type { Expr, LadProgram, Network, Output, Rung } from "./ast";

/*
 * Représentation « graphe de flux » d'un réseau LADDER, commune aux formats d'échange
 * (SimaticML de TIA, PLCopen XML de CODESYS / Machine Expert) qui décrivent un réseau
 * comme des éléments reliés par des fils, sans notion de série ni de parallèle.
 *
 * - un nœud « élément » est un contact, un front, un comparateur ou une boîte (passe le flux) ;
 * - un nœud « bobine » termine (ou laisse passer) le flux, comme dans TIA ;
 * - chaque nœud a une liste de SOURCES : la barre (null) ou d'autres nœuds.
 *   Plusieurs sources = jonction OU. Un nœud source de plusieurs autres = éventail.
 *
 * graphToNetwork reconstruit les séries / parallèles du DSL ; networkToGraph fait l'inverse.
 */

export type FlowNode =
  | { id: string; kind: "element"; element: Expr; sources: (string | null)[] }
  | { id: string; kind: "coil"; output: Output; sources: (string | null)[] };

export interface FlowGraph {
  title: string | null;
  comment?: string;
  nodes: FlowNode[];
}

export interface GraphResult {
  network: Network | null;
  warnings: string[];
}

/* ---------- Graphe → réseau ---------- */

const items = (e: Expr): Expr[] => (e.type === "series" ? e.items : [e]);
const branches = (e: Expr): Expr[] => (e.type === "parallel" ? e.branches : [e]);

function series(a: Expr | null, b: Expr): Expr {
  if (!a) return b;
  return { type: "series", items: [...items(a), ...items(b)] };
}

const seqToExpr = (seq: Expr[]): Expr => (seq.length === 1 ? seq[0] : { type: "series", items: seq });

/**
 * OU de plusieurs suites d'éléments, en factorisant les débuts communs (éventail puis
 * jonction) : (A & B & C) | (A & B & D) | (A & E)  →  A & (B & (C | D) | E).
 * Les éléments sont comparés par identité d'objet : c'est le même nœud du graphe qui a
 * été traversé, pas un contact qui lui ressemble.
 */
function factor(seqs: Expr[][]): Expr {
  const groups: Expr[][][] = [];
  for (const seq of seqs) {
    const group = groups.find((g) => g[0][0] === seq[0]);
    if (group) group.push(seq);
    else groups.push([seq]);
  }
  const terms = groups.map((g) => {
    if (g.length === 1) return seqToExpr(g[0]);
    // X | X & Y = X : une branche réduite à l'élément commun absorbe les autres.
    if (g.some((s) => s.length === 1)) return g[0][0];
    const rest = factor(g.map((s) => s.slice(1)));
    return { type: "series" as const, items: [g[0][0], ...items(rest)] };
  });
  const flat = terms.flatMap(branches);
  return flat.length === 1 ? flat[0] : { type: "parallel", branches: flat };
}

/** OU de plusieurs flux ; une branche vide (directement la barre) court-circuite le OU. */
function parallel(list: (Expr | null)[]): Expr | null {
  if (list.some((b) => b === null)) return null;
  const flat = (list as Expr[]).flatMap(branches);
  if (flat.length === 1) return flat[0];
  return factor(flat.map(items));
}

export function graphToNetwork(graph: FlowGraph): GraphResult {
  const warnings: string[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outCache = new Map<string, Expr | null>();
  const visiting = new Set<string>();

  /** Flux à l'entrée d'un nœud (null = directement la barre). */
  const inputOf = (node: FlowNode): Expr | null | undefined => {
    if (node.sources.length === 0) return undefined; // non relié
    const parts: (Expr | null)[] = [];
    for (const src of node.sources) {
      if (src === null) parts.push(null);
      else {
        const out = outputOf(src);
        if (out === undefined) return undefined;
        parts.push(out);
      }
    }
    return parallel(parts);
  };

  /** Flux à la sortie d'un nœud. Une bobine laisse passer le flux (bobines en série dans TIA). */
  function outputOf(id: string): Expr | null | undefined {
    if (outCache.has(id)) return outCache.get(id);
    const node = byId.get(id);
    if (!node) {
      warnings.push(`Connexion vers un élément inconnu (${id}) ignorée`);
      return undefined;
    }
    if (visiting.has(id)) {
      warnings.push("Boucle dans les connexions : réseau ignoré");
      return undefined;
    }
    visiting.add(id);
    const input = inputOf(node);
    visiting.delete(id);
    if (input === undefined) return undefined;
    const out = node.kind === "coil" ? input : series(input, node.element);
    outCache.set(id, out);
    return out;
  }

  // Rungs dans l'ordre des nœuds : bobines regroupées par condition identique (même source),
  // boîtes terminales (MOVE, calcul… sans bobine derrière) en rung sans bobine.
  const rungs: Rung[] = [];
  const byCondition = new Map<string, Rung>();
  const consumed = new Set<string>();
  for (const node of graph.nodes) for (const s of node.sources) if (s !== null) consumed.add(s);

  for (const node of graph.nodes) {
    if (node.kind === "coil") {
      const condition = inputOf(node);
      if (condition === undefined) {
        warnings.push(`Bobine ${node.output.operand.text} non reliée : ignorée`);
        continue;
      }
      if (condition === null) {
        warnings.push(
          `Bobine ${node.output.operand.text} directement sur la barre : contact « toujours vrai » ajouté`,
        );
      }
      const cond: Expr = condition ?? {
        type: "contact",
        kind: "NO",
        operand: { kind: "global", text: '"Toujours_Vrai"' },
      };
      const key = JSON.stringify(node.sources);
      const existing = byCondition.get(key);
      if (existing) existing.outputs.push(node.output);
      else {
        const rung: Rung = { condition: cond, outputs: [node.output] };
        byCondition.set(key, rung);
        rungs.push(rung);
      }
    } else if (!consumed.has(node.id)) {
      const out = outputOf(node.id);
      if (out === undefined || out === null) continue;
      if (node.element.type === "box") rungs.push({ condition: out, outputs: [] });
      else warnings.push("Contact non relié à une bobine : ignoré");
    }
  }

  if (rungs.length === 0)
    return { network: null, warnings: [...warnings, "Réseau sans bobine ni boîte : ignoré"] };
  const network: Network = { title: graph.title, rungs };
  if (graph.comment) network.comment = graph.comment;
  return { network, warnings };
}

export function graphsToProgram(graphs: FlowGraph[]): { program: LadProgram; warnings: string[] } {
  const warnings: string[] = [];
  const networks: Network[] = [];
  graphs.forEach((g, i) => {
    const r = graphToNetwork(g);
    warnings.push(...r.warnings.map((w) => `Réseau ${i + 1} : ${w}`));
    if (r.network) networks.push(r.network);
  });
  return { program: { networks }, warnings };
}

/* ---------- Réseau → graphe (export) ---------- */

/**
 * Transforme un réseau en graphe : chaque élément devient un nœud, les séries des chaînes,
 * les parallèles des éventails (sources communes) suivis d'une jonction OU. Les identifiants
 * sont séquentiels (n1, n2…), le format de sortie les renumérote à sa façon.
 */
export function networkToGraph(network: Network): FlowGraph {
  const nodes: FlowNode[] = [];
  let next = 0;
  const id = () => `n${++next}`;

  /** Place expr derrière les sources données ; renvoie les sources de sortie (fin de l'expression). */
  const place = (expr: Expr, sources: (string | null)[]): (string | null)[] => {
    switch (expr.type) {
      case "series":
        return expr.items.reduce<(string | null)[]>((src, item) => place(item, src), sources);
      case "parallel":
        // Chaque branche part des mêmes sources ; leurs sorties se rejoignent (OU) sur l'élément suivant.
        return expr.branches.flatMap((b) => place(b, sources));
      default: {
        const nodeId = id();
        nodes.push({ id: nodeId, kind: "element", element: expr, sources });
        return [nodeId];
      }
    }
  };

  for (const rung of network.rungs) {
    const ends = place(rung.condition, [null]);
    for (const output of rung.outputs) nodes.push({ id: id(), kind: "coil", output, sources: ends });
  }
  return { title: network.title, ...(network.comment ? { comment: network.comment } : {}), nodes };
}
