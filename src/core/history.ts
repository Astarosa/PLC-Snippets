/*
 * Historique annuler / rétablir d'une valeur (le texte LADDER de l'éditeur).
 * La valeur courante n'est pas stockée ici : elle reste dans le formulaire.
 */

export interface History<T> {
  past: T[];
  future: T[];
  /** Dernier enregistrement, pour regrouper la frappe continue en mode texte. */
  lastAt: number;
  lastGroup: string | null;
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], lastAt: 0, lastGroup: null });

/** Nombre maximal d'étapes gardées. */
export const HISTORY_LIMIT = 100;
/** Deux changements du même groupe à moins de ce délai ne font qu'une étape (frappe au clavier). */
export const GROUP_DELAY_MS = 1000;

/**
 * Enregistre `previous` (la valeur avant le changement). Un changement annule l'avenir
 * (on ne peut plus « rétablir » après une nouvelle modification).
 * `group` regroupe les changements rapprochés (ex. "texte") ; null = toujours une étape.
 */
export function record<T>(
  h: History<T>,
  previous: T,
  group: string | null = null,
  now = Date.now(),
): History<T> {
  const merge =
    group !== null && h.lastGroup === group && now - h.lastAt < GROUP_DELAY_MS && h.past.length > 0;
  return {
    past: merge ? h.past : [...h.past, previous].slice(-HISTORY_LIMIT),
    future: [],
    lastAt: now,
    lastGroup: group,
  };
}

/** Revient à l'étape précédente : nouvelle valeur et historique, ou null s'il n'y en a pas. */
export function undo<T>(h: History<T>, present: T): { value: T; history: History<T> } | null {
  if (h.past.length === 0) return null;
  return {
    value: h.past[h.past.length - 1],
    history: { past: h.past.slice(0, -1), future: [present, ...h.future], lastAt: 0, lastGroup: null },
  };
}

/** Refait l'étape annulée : nouvelle valeur et historique, ou null s'il n'y en a pas. */
export function redo<T>(h: History<T>, present: T): { value: T; history: History<T> } | null {
  if (h.future.length === 0) return null;
  return {
    value: h.future[0],
    history: {
      past: [...h.past, present].slice(-HISTORY_LIMIT),
      future: h.future.slice(1),
      lastAt: 0,
      lastGroup: null,
    },
  };
}
