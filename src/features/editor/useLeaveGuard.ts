import { useBlocker } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef } from "react";

const QUESTION = "Des modifications ne sont pas enregistrées. Quitter sans enregistrer ?";
const confirmLeave = () =>
  ask(QUESTION, {
    title: "Modifications non enregistrées",
    kind: "warning",
    okLabel: "Quitter sans enregistrer",
    cancelLabel: "Rester",
  });

/**
 * Demande confirmation avant de perdre des modifications : navigation dans l'app
 * (Annuler, un autre snippet, l'accueil…) et fermeture de la fenêtre.
 * `allowLeave()` est appelé juste avant d'enregistrer : la navigation qui suit ne demande rien.
 */
export function useLeaveGuard(dirty: boolean, saveFailed: boolean) {
  const leaving = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Enregistrement refusé (erreurs) : on reste, la garde redevient active.
  useEffect(() => {
    if (saveFailed) leaving.current = false;
  }, [saveFailed]);

  const mustAsk = useCallback(() => dirtyRef.current && !leaving.current, []);

  useBlocker({
    shouldBlockFn: async () => (mustAsk() ? !(await confirmLeave()) : false),
    enableBeforeUnload: mustAsk,
  });

  // Fermeture de la fenêtre de l'app (croix, Alt+F4).
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    win
      .onCloseRequested(async (event) => {
        if (!mustAsk()) return;
        event.preventDefault();
        if (await confirmLeave()) await win.destroy();
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [mustAsk]);

  return {
    allowLeave: () => {
      leaving.current = true;
    },
  };
}
