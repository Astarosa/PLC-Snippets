import { matchesQuery } from "./parse";
import type { BlockType, Lang, Snippet } from "./schema";

/** Filtres de la bibliothèque : texte libre + types de bloc + langages + tags (ET entre familles). */
export interface LibraryFilters {
  query: string;
  blockTypes: BlockType[];
  langs: Lang[];
  tags: string[];
}

export const NO_FILTERS: LibraryFilters = { query: "", blockTypes: [], langs: [], tags: [] };

/** true si au moins un filtre est actif (la liste n'est alors plus réordonnable). */
export const hasFilters = (f: LibraryFilters) =>
  f.query.trim() !== "" || f.blockTypes.length > 0 || f.langs.length > 0 || f.tags.length > 0;

/**
 * Dans une même famille, un snippet passe s'il a l'une des valeurs cochées (FB ou FC) ;
 * entre familles, il doit tout satisfaire. Les tags demandés doivent tous être présents.
 */
export function filterSnippets(snippets: Snippet[], f: LibraryFilters): Snippet[] {
  const tags = f.tags.map((t) => t.toLowerCase());
  return snippets.filter((s) => {
    if (!matchesQuery(s, f.query)) return false;
    if (f.blockTypes.length > 0 && !f.blockTypes.includes(s.meta.blockType)) return false;
    if (f.langs.length > 0 && !s.variants.some((v) => f.langs.includes(v.lang))) return false;
    const own = s.meta.tags.map((t) => t.toLowerCase());
    return tags.every((t) => own.includes(t));
  });
}

/** Tags de la bibliothèque, du plus utilisé au moins utilisé (puis par ordre alphabétique). */
export function tagCounts(snippets: Snippet[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const s of snippets)
    for (const tag of s.meta.tags) {
      const k = tag.toLowerCase();
      const entry = counts.get(k) ?? { tag, count: 0 };
      entry.count++;
      counts.set(k, entry);
    }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "fr"));
}

/** « il y a 5 min », « hier », « 22 nov. » : date de modification lisible. */
export function relativeDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const minutes = Math.round((now.getTime() - date.getTime()) / 60000);
  if (Number.isNaN(minutes)) return "";
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24 && date.getDate() === now.getDate()) return `il y a ${hours} h`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "hier";
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}
