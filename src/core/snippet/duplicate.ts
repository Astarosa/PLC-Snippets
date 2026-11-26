import { type RawSnippet, snippetToRaw } from "./parse";
import type { Snippet } from "./schema";

/** Premier identifiant libre : « x-copie », puis « x-copie-2 », « x-copie-3 »… */
export function copyId(id: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `${id.replace(/-copie(-\d+)?$/, "")}-copie`.slice(0, 80);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Copie complète d'un snippet (code, interface, variables API, notes), sous un nouvel identifiant. */
export function duplicateSnippet(
  snippet: Snippet,
  taken: Iterable<string>,
  now = new Date().toISOString(),
): RawSnippet {
  const id = copyId(snippet.id, taken);
  const copy: Snippet = {
    ...snippet,
    meta: { ...snippet.meta, title: `${snippet.meta.title} (copie)`, createdAt: now, updatedAt: now },
  };
  return snippetToRaw(copy, id);
}
