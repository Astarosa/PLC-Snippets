import { useState } from "react";
import { type Diagnostic, errorsOf, locate, warningsOf } from "../../core/ladder/check";

const ICON = { error: "⛔", warning: "⚠" } as const;
const COLOR = { error: "text-red-300", warning: "text-amber-300" } as const;

/**
 * Liste des problèmes détectés dans le LADDER (erreurs bloquantes pour l'export TIA,
 * puis avertissements de logique). Un clic sur une ligne sélectionne l'élément concerné.
 */
export function DiagnosticsPanel({
  diagnostics,
  onPick,
  onFix,
}: {
  diagnostics: Diagnostic[];
  onPick?: (d: Diagnostic) => void;
  /** Applique la correction proposée (ex. déclarer les variables API manquantes). */
  onFix?: (d: Diagnostic) => void;
}) {
  const errors = errorsOf(diagnostics);
  const warnings = warningsOf(diagnostics);
  const [open, setOpen] = useState(true);

  if (diagnostics.length === 0) {
    return (
      <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-300">
        ✓ Aucun problème détecté : le bloc est prêt pour l'export TIA.
      </p>
    );
  }

  const border = errors.length > 0 ? "border-red-900 bg-red-950/30" : "border-amber-900 bg-amber-950/30";
  return (
    <div className={`rounded-lg border ${border} text-xs`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-left"
      >
        {errors.length > 0 && (
          <span className="font-semibold text-red-300">
            {ICON.error} {errors.length} erreur{errors.length > 1 ? "s" : ""}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="font-semibold text-amber-300">
            {ICON.warning} {warnings.length} avertissement{warnings.length > 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto text-slate-400">{open ? "▴" : "▾"}</span>
        {/* Sur sa propre ligne : tient dans le panneau étroit de l'éditeur. */}
        <span className="w-full text-slate-400">
          {errors.length > 0
            ? "Export TIA bloqué tant que les erreurs restent."
            : "Export possible, mais vérifie la logique."}
        </span>
      </button>
      {open && (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto border-t border-slate-800 px-1 py-1">
          {[...errors, ...warnings].map((d, i) => {
            const clickable = !!onPick && d.network !== undefined;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: liste recalculée à chaque modification
              <li key={i} className="flex gap-2 rounded px-2 py-1">
                <span className={COLOR[d.severity]}>{ICON[d.severity]}</span>
                {/* Emplacement au-dessus du message, correction en dessous : rien ne se chevauche, même étroit. */}
                <div className="min-w-0 flex-1 space-y-1">
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => onPick?.(d)}
                    className={`block w-full rounded text-left ${clickable ? "hover:text-sky-300" : "cursor-default"}`}
                  >
                    <span className="block text-[11px] text-slate-400">{locate(d)}</span>
                    <span className="text-slate-200">{d.message}</span>
                  </button>
                  {d.fix === "declare-tags" && onFix && (
                    <button
                      type="button"
                      onClick={() => onFix(d)}
                      className="rounded border border-amber-700 bg-amber-950/50 px-2 py-0.5 text-amber-200 hover:bg-amber-900/60"
                    >
                      Tout déclarer
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Problèmes de l'élément sélectionné, affichés sous ses propriétés. */
export function ElementDiagnostics({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 border-t border-slate-800 pt-2 text-xs">
      {diagnostics.map((d, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: liste recalculée à chaque modification
        <li key={i} className={COLOR[d.severity]}>
          {ICON[d.severity]} {d.message}
        </li>
      ))}
    </ul>
  );
}
