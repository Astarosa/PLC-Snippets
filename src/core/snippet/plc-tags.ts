import type { Expr, LadProgram, Output, Value } from "../ladder/ast";
import type { Mnemonic } from "../stl/mnemonics";
import type { PlcTag } from "./schema";

/*
 * Table des variables API (« PLC tags » de TIA) : adresses, déduction des types depuis
 * le LADDER, attribution automatique des adresses manquantes.
 *
 * Les adresses sont stockées en mnémonique internationale (%I / %Q / %M) ; %E et %A
 * (allemand) sont acceptés à la saisie et reconvertis à l'export selon le projet TIA.
 */

export type Area = "I" | "Q" | "M";
export type Size = "X" | "B" | "W" | "D";

export interface Address {
  area: Area;
  size: Size;
  byte: number;
  bit: number;
}

const SIZE_BITS: Record<Size, number> = { X: 1, B: 8, W: 16, D: 32 };

/** « %I0.0 », « %QW2 », « MD10 », « %E1.3 » (allemand) → adresse, ou null. */
export function parseAddress(text: string): Address | null {
  const m = /^%?([IQMEA])([XBWD])?(\d+)(?:\.(\d+))?$/i.exec(text.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const area: Area = letter === "E" ? "I" : letter === "A" ? "Q" : (letter as Area);
  const size = (m[2]?.toUpperCase() ?? "X") as Size;
  const byte = Number(m[3]);
  const hasBit = m[4] !== undefined;
  if (size === "X" && !hasBit) return null;
  if (size !== "X" && hasBit) return null;
  const bit = hasBit ? Number(m[4]) : 0;
  if (bit > 7 || byte > 65535) return null;
  return { area, size, byte, bit };
}

/** Écriture canonique (mnémonique internationale par défaut). */
export function formatAddress(a: Address, mnemonic: Mnemonic = "EN"): string {
  const area = mnemonic === "DE" ? { I: "E", Q: "A", M: "M" }[a.area] : a.area;
  return a.size === "X" ? `%${area}${a.byte}.${a.bit}` : `%${area}${a.size}${a.byte}`;
}

/** Adresse stockée : mnémonique internationale (« %e0.0 » → « %I0.0 »), telle quelle si illisible. */
export function canonicalAddress(text: string): string {
  const a = parseAddress(text);
  return a ? formatAddress(a) : text.trim().toUpperCase();
}

/** Taille d'adresse attendue pour un type élémentaire (null = type non vérifié). */
export function sizeForType(type: string): Size | null {
  const t = type.trim().replace(/^"|"$/g, "").toLowerCase();
  if (t === "bool") return "X";
  if (/^(byte|sint|usint|char)$/.test(t)) return "B";
  if (/^(word|int|uint|wchar|s5time|date)$/.test(t)) return "W";
  if (/^(dword|dint|udint|real|time|tod|time_of_day)$/.test(t)) return "D";
  return null;
}

const EXAMPLE: Record<Size, string> = { X: "%I0.0", B: "%MB10", W: "%MW10", D: "%MD10" };
const SIZE_LABEL: Record<Size, string> = { X: "bit", B: "octet", W: "mot", D: "double mot" };

/** Problème d'adresse d'une variable (null = correcte ou absente). */
export function addressProblem(tag: PlcTag): string | null {
  if (!tag.address?.trim()) return null;
  const a = parseAddress(tag.address);
  if (!a) return `adresse « ${tag.address} » invalide (ex. %I0.0, %QW2, %MD10)`;
  const expected = sizeForType(tag.type);
  if (expected && expected !== a.size)
    return `un ${tag.type} demande une adresse ${SIZE_LABEL[expected]} (ex. ${EXAMPLE[expected]}), pas ${tag.address}`;
  return null;
}

const range = (a: Address) => {
  const start = a.byte * 8 + (a.size === "X" ? a.bit : 0);
  return [start, start + SIZE_BITS[a.size]] as const;
};

/** Paires de variables dont les adresses se chevauchent (même zone mémoire). */
export function overlappingTags(tags: PlcTag[]): [PlcTag, PlcTag][] {
  const placed = tags
    .map((tag) => ({ tag, a: tag.address ? parseAddress(tag.address) : null }))
    .filter((x): x is { tag: PlcTag; a: Address } => x.a !== null);
  const pairs: [PlcTag, PlcTag][] = [];
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const p = placed[i];
      const q = placed[j];
      if (p.a.area !== q.a.area) continue;
      const [s1, e1] = range(p.a);
      const [s2, e2] = range(q.a);
      if (s1 < e2 && s2 < e1) pairs.push([p.tag, q.tag]);
    }
  return pairs;
}

/* ---------- Attribution des adresses manquantes ---------- */

/** Premier octet de la zone %M utilisée pour les variables sans adresse. */
export const AUTO_M_START = 1000;

/**
 * Donne une adresse %M libre aux variables qui n'en ont pas : bits regroupés par octet,
 * mots et doubles mots alignés sur un octet pair. Les types non élémentaires restent sans adresse.
 */
export function assignAddresses(tags: PlcTag[]): { tags: PlcTag[]; assigned: PlcTag[] } {
  const used = new Set<number>(); // bits occupés en %M
  for (const t of tags) {
    const a = t.address ? parseAddress(t.address) : null;
    if (a?.area !== "M") continue;
    const [s, e] = range(a);
    for (let b = s; b < e; b++) used.add(b);
  }
  const free = (start: number, bits: number) => {
    for (let b = start; b < start + bits; b++) if (used.has(b)) return false;
    return true;
  };
  const take = (size: Size): Address => {
    const bits = SIZE_BITS[size];
    const step = size === "X" ? 1 : size === "B" ? 8 : 16;
    for (let b = AUTO_M_START * 8; ; b += step) {
      if (free(b, bits)) {
        for (let k = b; k < b + bits; k++) used.add(k);
        return { area: "M", size, byte: Math.floor(b / 8), bit: size === "X" ? b % 8 : 0 };
      }
    }
  };
  const assigned: PlcTag[] = [];
  const result = tags.map((t) => {
    if (t.address?.trim()) return t;
    const size = sizeForType(t.type);
    if (!size) return t;
    const withAddress = { ...t, address: formatAddress(take(size)) };
    assigned.push(withAddress);
    return withAddress;
  });
  return { tags: result, assigned };
}

/* ---------- Variables utilisées par le LADDER ---------- */

export interface UsedGlobal {
  name: string;
  /** Type proposé d'après l'usage (broche, bobine, contact…). */
  type: string;
}

const TYPE_FOR_PIN: Record<string, string> = {
  PT: "Time",
  ET: "Time",
  PV: "Int",
  CV: "Int",
  IN1: "Int",
  IN2: "Int",
  OUT: "Int",
  IN: "Int",
};

const globalName = (v: Value): string | null => {
  if (v.kind !== "global") return null;
  const m = /^"([^"]*)"$/.exec(v.text); // variable seule, sans « .membre »
  return m && !m[1].includes("???") ? m[1] : null;
};

/** Type d'une constante, pour deviner le type de l'autre côté d'un MOVE ou d'un comparateur. */
function literalType(v: Value): string | null {
  if (v.kind !== "literal") return null;
  const t = v.text.toUpperCase();
  if (/^L?T#/.test(t)) return "Time";
  if (t === "TRUE" || t === "FALSE") return "Bool";
  if (/^[+-]?\d+\.\d+/.test(t)) return "Real";
  if (/^[+-]?\d+$/.test(t)) return "Int";
  return null;
}

/**
 * Variables API utilisées telles quelles dans le LADDER (sans « .membre »), avec un type
 * déduit de leur usage. Les DB d'instance et les DB accédés par membre sont exclus :
 * ce ne sont pas des variables de la table.
 */
export function usedGlobals(program: LadProgram): UsedGlobal[] {
  const found = new Map<string, UsedGlobal>();
  const instances = new Set<string>();
  const add = (v: Value, type: string) => {
    const name = globalName(v);
    if (!name) return;
    const k = name.toLowerCase();
    // Le premier usage typé l'emporte, sauf si un usage plus précis qu'un Bool arrive.
    const prev = found.get(k);
    if (!prev || (prev.type === "Bool" && type !== "Bool")) found.set(k, { name, type });
  };
  const visit = (e: Expr) => {
    switch (e.type) {
      case "series":
        for (const c of e.items) visit(c);
        return;
      case "parallel":
        for (const c of e.branches) visit(c);
        return;
      case "contact":
        add(e.operand, "Bool");
        return;
      case "edge":
        add(e.operand, "Bool");
        add(e.memory, "Bool");
        return;
      case "compare": {
        const type = literalType(e.right) ?? literalType(e.left) ?? "Int";
        add(e.left, type);
        add(e.right, type);
        return;
      }
      case "box": {
        if (e.instance) {
          const name = globalName(e.instance);
          if (name) instances.add(name.toLowerCase());
        }
        const moveType = e.box === "MOVE" ? (literalType(e.params.IN) ?? "Int") : null;
        for (const [pin, v] of Object.entries(e.params)) {
          const boolPin = ["R", "LD", "CD", "Q", "QU", "QD"].includes(pin);
          add(v, boolPin ? "Bool" : (moveType ?? TYPE_FOR_PIN[pin] ?? "Int"));
        }
        return;
      }
    }
  };
  for (const network of program.networks)
    for (const rung of network.rungs) {
      visit(rung.condition);
      for (const o of rung.outputs) add(o.operand, "Bool");
    }
  return [...found.values()].filter((g) => !instances.has(g.name.toLowerCase()));
}

/** Variables API d'un seul élément (contact, boîte, bobine…), pour la déclaration à la volée. */
export function elementGlobals(element: Expr | Output): UsedGlobal[] {
  const isOutput = "operand" in element && !("type" in element);
  const rung = isOutput
    ? { condition: { type: "series" as const, items: [] }, outputs: [element as Output] }
    : { condition: element as Expr, outputs: [] };
  return usedGlobals({ networks: [{ title: null, rungs: [rung] }] });
}

/** Variables du LADDER absentes de la table, avec leur type proposé. */
export function undeclaredGlobals(program: LadProgram, tags: PlcTag[]): UsedGlobal[] {
  const declared = new Set(tags.map((t) => t.name.toLowerCase()));
  return usedGlobals(program).filter((g) => !declared.has(g.name.toLowerCase()));
}

export const findTag = (tags: PlcTag[], name: string) =>
  tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
