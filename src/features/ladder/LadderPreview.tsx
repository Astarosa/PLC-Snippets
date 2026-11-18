import { useMemo } from "react";
import { formatLadError, parseLadder } from "../../core/ladder/parse";
import { LadderDiagram } from "./LadderDiagram";

/** Schéma dessiné depuis le DSL, ou l'erreur de syntaxe avec sa position. */
export function LadderPreview({ source }: { source: string }) {
  const result = useMemo(() => (source.trim() ? parseLadder(source) : null), [source]);

  if (!result) return <p className="p-4 text-sm text-slate-500">Le schéma apparaîtra ici.</p>;
  if (!result.ok) {
    return (
      <p className="p-4 font-mono text-sm text-amber-300">
        <span className="mr-2 rounded bg-amber-950 px-1.5 py-0.5 text-xs">Syntaxe</span>
        {formatLadError(result.error)}
      </p>
    );
  }
  return (
    <div className="p-4">
      <LadderDiagram program={result.program} />
    </div>
  );
}
