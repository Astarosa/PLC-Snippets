/**
 * Renommer une variable dans le code d'un snippet (LADDER, SCL, LIST).
 *
 * - variable locale (interface) : `#Nom` et `#"Nom"` ;
 * - variable API globale (PLC tags) : `"Nom"`, aussi devant un membre (`"Nom".Q`).
 *
 * Les commentaires `//` ne sont pas modifiés : ils décrivent souvent l'ancien
 * fonctionnement, au rédacteur de les relire.
 */

export type VariableScope = "local" | "global";

export interface RenameResult {
  text: string;
  count: number;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Identifiant utilisable en `#Nom` sans guillemets. */
export const isPlainIdentifier = (name: string) => /^[A-Za-z_]\w*$/.test(name);

/** Un nom vers lequel on peut renommer (non vide, sans guillemet). */
export function isValidName(scope: VariableScope, name: string): boolean {
  const n = name.trim();
  return n.length > 0 && !n.includes('"') && !/[\r\n]/.test(n) && (scope === "global" || n === name);
}

function pattern(scope: VariableScope, name: string): RegExp {
  const e = escapeRegExp(name);
  return scope === "local" ? new RegExp(`#(?:"${e}"|${e}(?![\\w]))`, "g") : new RegExp(`"${e}"`, "g");
}

function replacement(scope: VariableScope, name: string): string {
  if (scope === "global") return `"${name}"`;
  return isPlainIdentifier(name) ? `#${name}` : `#"${name}"`;
}

/** Position du `//` de commentaire d'une ligne (hors chaînes), ou -1. */
function commentStart(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "/" && line[i + 1] === "/") {
      return i;
    }
  }
  return -1;
}

/** Renomme dans un texte, en laissant les commentaires `//` tels quels. */
export function renameInText(text: string, scope: VariableScope, from: string, to: string): RenameResult {
  if (from === to || from.length === 0) return { text, count: 0 };
  const re = pattern(scope, from);
  const by = replacement(scope, to);
  let count = 0;
  const lines = text.split("\n").map((line) => {
    const at = commentStart(line);
    const code = at < 0 ? line : line.slice(0, at);
    const rest = at < 0 ? "" : line.slice(at);
    const renamed = code.replace(re, () => {
      count++;
      return by;
    });
    return renamed + rest;
  });
  return { text: lines.join("\n"), count };
}

/** Nombre d'utilisations d'un nom dans un texte (hors commentaires). */
export const countInText = (text: string, scope: VariableScope, name: string) =>
  name.length === 0 ? 0 : renameInText(text, scope, name, `${name}\u0000`).count;
