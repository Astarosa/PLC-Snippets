import { type RawSnippet, snippetToRaw } from "../snippet/parse";
import type { ImportItem } from "./types";

export type ConflictChoice = "keep-both" | "replace" | "skip";

export interface ItemChoice {
  include: boolean;
  /** Utilisé seulement si l'identifiant existe déjà dans la bibliothèque. */
  conflict: ConflictChoice;
}

export interface PlannedWrite {
  /** Index de l'élément dans l'aperçu. */
  index: number;
  raw: RawSnippet;
  mode: "create" | "replace";
  title: string;
}

/** Identifiant libre : base, base-2, base-3… (80 caractères maximum). */
export function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 80 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Choix par défaut : tout ce qui est valide est coché, les doublons sont gardés tous les deux. */
export const defaultChoice = (item: ImportItem): ItemChoice => ({
  include: item.snippet !== null,
  conflict: "keep-both",
});

/**
 * Transforme les choix de l'aperçu en écritures. Les snippets sont écrits au format
 * courant (déjà migrés à la lecture). Deux snippets d'un même import ne s'écrasent jamais.
 */
export function planImport(items: ImportItem[], existing: string[], choices: ItemChoice[]): PlannedWrite[] {
  const libraryIds = new Set(existing);
  const taken = new Set(existing);
  const plan: PlannedWrite[] = [];
  items.forEach((item, i) => {
    const choice = choices[i] ?? defaultChoice(item);
    if (!item.snippet || !choice.include) return;
    const inLibrary = libraryIds.has(item.id);
    if (inLibrary && choice.conflict === "skip") return;
    const alreadyPlanned = plan.some((p) => p.raw.id === item.id);
    const replace = inLibrary && choice.conflict === "replace" && !alreadyPlanned;
    const id = replace ? item.id : uniqueId(item.id, taken);
    taken.add(id);
    plan.push({
      index: i,
      raw: snippetToRaw(item.snippet, id),
      mode: replace ? "replace" : "create",
      title: item.snippet.meta.title,
    });
  });
  return plan;
}
