import { useMemo, useState } from "react";
import { parseLadder } from "../../core/ladder/parse";
import { LadderPreview } from "./LadderPreview";
import { Simulator } from "./Simulator";

/** Schéma d'un snippet, avec le passage en simulation. */
export function LadderView({ source }: { source: string }) {
  const [simulating, setSimulating] = useState(false);
  const program = useMemo(() => {
    const r = source.trim() ? parseLadder(source) : null;
    return r?.ok ? r.program : null;
  }, [source]);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60">
      {program && (
        <div className="flex justify-end border-b border-slate-800 px-3 py-1.5">
          <button
            type="button"
            aria-pressed={simulating}
            onClick={() => setSimulating((s) => !s)}
            className={`rounded px-2.5 py-1 text-xs font-medium ${
              simulating
                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                : "text-emerald-300 hover:bg-slate-800"
            }`}
          >
            {simulating ? "■ Arrêter la simulation" : "▶ Simuler"}
          </button>
        </div>
      )}
      {simulating && program ? (
        <Simulator key={source} program={program} />
      ) : (
        <LadderPreview source={source} />
      )}
    </div>
  );
}
