import { addressProblem, type UsedGlobal } from "../../core/snippet/plc-tags";
import type { PlcTag } from "../../core/snippet/schema";

const input =
  "w-full rounded border bg-slate-950 px-2 py-1 font-mono text-[13px] text-slate-100 focus:border-sky-600 focus:outline-none";

/**
 * Table des variables API du snippet (« PLC tags » de TIA), exportable en .xlsx.
 * On peut la remplir à la main, ou d'un clic avec les variables utilisées dans le LADDER.
 */
export function PlcTagsEditor({
  value,
  onChange,
  undeclared,
  compact = false,
}: {
  value: PlcTag[];
  onChange: (tags: PlcTag[]) => void;
  /** Variables du LADDER absentes de la table (type proposé d'après l'usage). */
  undeclared: UsedGlobal[];
  /** Panneau étroit : chaque variable sur deux lignes. */
  compact?: boolean;
}) {
  const set = (i: number, patch: Partial<PlcTag>) =>
    onChange(value.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onChange([...value, { name: "", type: "Bool" }])}
          className="text-xs text-sky-400 hover:underline"
        >
          + ajouter
        </button>
        {undeclared.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([...value, ...undeclared.map((g) => ({ name: g.name, type: g.type }))])}
            title={undeclared.map((g) => `${g.name} : ${g.type}`).join("\n")}
            className="rounded border border-amber-800 bg-amber-950/40 px-2 py-0.5 text-xs text-amber-200 hover:bg-amber-900/50"
          >
            Déclarer les {undeclared.length} variable{undeclared.length > 1 ? "s" : ""} du LADDER
          </button>
        )}
        <span className="text-xs text-slate-500">
          {compact
            ? "Adresse vide = %M libre à l'export."
            : "Adresse vide = %M libre attribuée à l'export. %E / %A acceptés."}
        </span>
      </div>
      {value.length > 0 &&
        (compact ? (
          <div className="space-y-1.5">
            {value.map((tag, i) => {
              const problem = addressProblem(tag);
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: lignes éditées en place, sans identifiant
                  key={i}
                  className="relative grid grid-cols-2 gap-1 rounded-md border border-slate-800 p-1.5 pr-8"
                >
                  <input
                    className={`${input} border-slate-700`}
                    aria-label="Nom"
                    placeholder="Nom"
                    value={tag.name}
                    onChange={(e) => set(i, { name: e.target.value })}
                  />
                  <input
                    className={`${input} border-slate-700`}
                    aria-label="Type"
                    placeholder="Bool"
                    value={tag.type}
                    onChange={(e) => set(i, { type: e.target.value })}
                  />
                  <input
                    className={`${input} ${problem ? "border-amber-600" : "border-slate-700"}`}
                    aria-label="Adresse"
                    placeholder="auto (%M)"
                    title={problem ?? undefined}
                    value={tag.address ?? ""}
                    onChange={(e) => set(i, { address: e.target.value })}
                  />
                  <input
                    className={`${input} border-slate-700 font-sans`}
                    aria-label="Commentaire"
                    placeholder="Commentaire"
                    value={tag.comment ?? ""}
                    onChange={(e) => set(i, { comment: e.target.value })}
                  />
                  <button
                    type="button"
                    aria-label="Supprimer la ligne"
                    title="Supprimer la ligne"
                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                    className="absolute top-1.5 right-0 px-2 text-slate-500 hover:text-red-400"
                  >
                    ✕
                  </button>
                  {problem && <p className="col-span-2 px-1 text-[11px] text-amber-400">{problem}</p>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_2fr_auto] gap-1.5">
            <span className="px-1 text-[11px] text-slate-500">Nom</span>
            <span className="px-1 text-[11px] text-slate-500">Type</span>
            <span className="px-1 text-[11px] text-slate-500">Adresse</span>
            <span className="px-1 text-[11px] text-slate-500">Commentaire</span>
            <span />
            {value.map((tag, i) => {
              const problem = addressProblem(tag);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: lignes éditées en place, sans identifiant
                <div key={i} className="contents">
                  <input
                    className={`${input} border-slate-700`}
                    placeholder="Nom"
                    value={tag.name}
                    onChange={(e) => set(i, { name: e.target.value })}
                  />
                  <input
                    className={`${input} border-slate-700`}
                    placeholder="Bool"
                    value={tag.type}
                    onChange={(e) => set(i, { type: e.target.value })}
                  />
                  <input
                    className={`${input} ${problem ? "border-amber-600" : "border-slate-700"}`}
                    placeholder="auto (%M)"
                    title={problem ?? undefined}
                    value={tag.address ?? ""}
                    onChange={(e) => set(i, { address: e.target.value })}
                  />
                  <input
                    className={`${input} border-slate-700 font-sans`}
                    placeholder="Commentaire"
                    value={tag.comment ?? ""}
                    onChange={(e) => set(i, { comment: e.target.value })}
                  />
                  <button
                    type="button"
                    title="Supprimer la ligne"
                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                    className="px-2 text-slate-500 hover:text-red-400"
                  >
                    ✕
                  </button>
                  {problem && <p className="col-span-5 -mt-1 px-1 text-[11px] text-amber-400">{problem}</p>}
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
