import { CopyButton } from "./CopyButton";

/** Affichage du code avec numéros de ligne. Sera remplacé par CodeMirror (coloration SCL). */
export function CodeBlock({ code, title }: { code: string; title: string }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-3 py-2">
        <span className="font-mono text-xs text-slate-400">{title}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-6">
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: les lignes n'ont pas d'identité propre
          <div key={i} className="flex">
            <span className="mr-4 w-8 shrink-0 select-none text-right text-slate-600">{i + 1}</span>
            <span className="whitespace-pre text-slate-200">{line || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
