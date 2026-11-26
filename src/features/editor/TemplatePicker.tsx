import { type SnippetTemplate, TEMPLATES } from "../../core/snippet/templates";

/** Point de départ d'un nouveau snippet : vide ou un montage courant à adapter. */
export function TemplatePicker({
  onPick,
  onCancel,
}: {
  onPick: (t: SnippetTemplate) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] text-slate-400">Nouveau snippet</p>
          <h1 className="text-xl font-semibold text-slate-100">Point de départ</h1>
          <p className="mt-1 text-sm text-slate-400">
            Un modèle donne un LADDER, ses variables API et le SCL généré : remplace les noms et les adresses
            par ceux de ton installation.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="text-sm text-slate-300 hover:text-white">
          Annuler
        </button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t, i) => {
          const form = t.build();
          return (
            <li key={t.id}>
              <button
                type="button"
                // biome-ignore lint/a11y/noAutofocus: le premier choix (vide) est pris avec Entrée
                autoFocus={i === 0}
                onClick={() => onPick(t)}
                className="flex h-full w-full flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-left hover:border-sky-700 hover:bg-slate-900 focus:border-sky-600 focus:outline-none"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium text-slate-100">{t.label}</span>
                  {t.id !== "vide" && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                      {form.blockType}
                    </span>
                  )}
                </span>
                <span className="text-xs text-slate-400">{t.description}</span>
                {t.id !== "vide" && (
                  <span className="mt-auto text-[11px] text-slate-500">
                    {form.plcTags.length > 0
                      ? `${form.plcTags.length} variables API`
                      : `${Object.values(form.interface).flat().length} variables d'interface`}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
