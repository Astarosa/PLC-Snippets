import type { Snippet } from "./schema";

/**
 * Ordre d'affichage : d'abord les snippets rangés à la main (library.json),
 * puis les autres (nouveaux, ou ajoutés hors de l'app) par titre.
 */
export function sortByOrder(snippets: Snippet[], order: string[]): Snippet[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...snippets].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.meta.title.localeCompare(b.meta.title, "fr");
  });
}

/** Déplace l'élément `from` pour qu'il arrive à la position `to` (indices de la liste affichée). */
export function moveId(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
