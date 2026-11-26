import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useLibraryFilters } from "../state/library-filters";
import { useSettings } from "../state/settings";

/*
 * Raccourcis clavier globaux :
 *   Ctrl+N nouveau snippet · Ctrl+F rechercher · Ctrl+S enregistrer · Ctrl+D dupliquer ·
 *   Ctrl+Z annuler · Ctrl+Y (ou Ctrl+Maj+Z) rétablir.
 * Les actions qui dépendent de l'écran sont enregistrées par la page concernée avec useShortcut.
 */

export type ShortcutAction = "save" | "duplicate" | "undo" | "redo";

/** Champ de saisie ou éditeur de code : Ctrl+Z / Ctrl+Y y gardent leur annulation native. */
const isTextField = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], .cm-editor") !==
    null;

const handlers = new Map<ShortcutAction, { current: () => void }>();

/** Branche une action de l'écran courant sur son raccourci (le temps que le composant est affiché). */
export function useShortcut(action: ShortcutAction, handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    handlers.set(action, ref);
    return () => {
      if (handlers.get(action) === ref) handlers.delete(action);
    };
  }, [action]);
}

/** Écoute du clavier, à monter une fois (layout principal). */
export function useShortcuts() {
  const navigate = useNavigate();
  const focusSearch = useLibraryFilters((s) => s.focusSearch);
  const hasLibrary = useSettings((s) => s.libraryPath !== null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if ((key === "z" || key === "y") && !isTextField(e.target)) {
        const action = key === "y" || e.shiftKey ? "redo" : "undo";
        const handler = handlers.get(action);
        if (handler) {
          e.preventDefault();
          handler.current();
        }
        return;
      }
      if (e.shiftKey) return;
      const inCode = e.target instanceof Element && e.target.closest(".cm-editor") !== null;
      if (key === "s") {
        e.preventDefault();
        handlers.get("save")?.current();
      } else if (key === "d") {
        e.preventDefault();
        handlers.get("duplicate")?.current();
      } else if (key === "n" && hasLibrary) {
        e.preventDefault();
        navigate({ to: "/new" });
      } else if (key === "f" && !inCode) {
        // Dans un éditeur de code, Ctrl+F garde sa recherche dans le code.
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, focusSearch, hasLibrary]);
}
