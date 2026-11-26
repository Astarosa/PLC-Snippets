import type { FocusEvent } from "react";

/**
 * Props d'un champ « Nom » : à la sortie du champ, signale l'ancien et le nouveau nom
 * s'ils diffèrent (pour proposer de renommer la variable dans le code).
 */
export function nameFieldHandlers(onRenamed?: (from: string, to: string) => void) {
  if (!onRenamed) return {};
  return {
    onFocus: (e: FocusEvent<HTMLInputElement>) => {
      e.currentTarget.dataset.before = e.currentTarget.value;
    },
    onBlur: (e: FocusEvent<HTMLInputElement>) => {
      const before = e.currentTarget.dataset.before ?? "";
      const after = e.currentTarget.value;
      if (before && before !== after) onRenamed(before, after);
    },
  };
}
