import { useState } from "react";
import { CodeBlock } from "../../components/CodeBlock";
import { convertStl, MNEMONIC_LABELS, type Mnemonic } from "../../core/stl/mnemonics";

/** Bascule d'affichage allemand / anglais (ne modifie pas le fichier). */
export function MnemonicSwitch({ value, onChange }: { value: Mnemonic; onChange: (m: Mnemonic) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-700 text-xs">
      {(["DE", "EN"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          title={MNEMONIC_LABELS[m]}
          className={`px-3 py-1 ${value === m ? "bg-violet-900 text-violet-100" : "text-slate-400 hover:bg-slate-800"}`}
        >
          {m === "DE" ? "Allemand" : "Anglais"}
        </button>
      ))}
    </div>
  );
}

export function StlView({ code, file, saved }: { code: string; file: string; saved: Mnemonic }) {
  const [view, setView] = useState<Mnemonic>(saved);
  const shown = convertStl(code, saved, view);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <MnemonicSwitch value={view} onChange={setView} />
        <span className="text-xs text-slate-500">
          {view === saved
            ? `Enregistré en mnémonique ${saved === "DE" ? "allemande (SIMATIC)" : "anglaise (internationale)"}.`
            : "Converti pour l'affichage : le bouton Copier copie cette version."}
        </span>
      </div>
      <CodeBlock code={shown} title={file} language="stl" />
    </div>
  );
}
