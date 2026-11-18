import { interfaceSectionsFor } from "../../core/snippet/form";
import {
  type BlockType,
  INTERFACE_SECTIONS,
  type SnippetInterface,
  type Variable,
} from "../../core/snippet/schema";

const input =
  "w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[13px] text-slate-100 focus:border-sky-600 focus:outline-none";

const PLACEHOLDERS: Partial<Record<keyof SnippetInterface, string>> = {
  static: "TON_TIME",
  constant: "Int",
};

export function InterfaceEditor({
  blockType,
  value,
  onChange,
}: {
  blockType: BlockType;
  value: SnippetInterface;
  onChange: (value: SnippetInterface) => void;
}) {
  const keys = interfaceSectionsFor(blockType);
  if (keys.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Un réseau (NETWORK) utilise des variables API globales : pas d'interface à déclarer.
      </p>
    );
  }

  const update = (key: keyof SnippetInterface, rows: Variable[]) => onChange({ ...value, [key]: rows });

  return (
    <div className="space-y-4">
      {INTERFACE_SECTIONS.filter((s) => keys.includes(s.key)).map(({ key, label }) => (
        <div key={key}>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-semibold text-sky-300">{label}</span>
            <button
              type="button"
              onClick={() => update(key, [...value[key], { name: "", type: "" }])}
              className="text-xs text-sky-400 hover:underline"
            >
              + ajouter
            </button>
          </div>
          {value[key].length > 0 && (
            <div className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] gap-1.5">
              {value[key].map((row, i) => {
                const set = (patch: Partial<Variable>) =>
                  update(
                    key,
                    value[key].map((r, j) => (j === i ? { ...r, ...patch } : r)),
                  );
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: lignes éditées en place, sans identifiant
                  <div key={i} className="contents">
                    <input
                      className={input}
                      placeholder="Nom"
                      value={row.name}
                      onChange={(e) => set({ name: e.target.value })}
                    />
                    <input
                      className={input}
                      placeholder={PLACEHOLDERS[key] ?? "Bool"}
                      value={row.type}
                      onChange={(e) => set({ type: e.target.value })}
                    />
                    <input
                      className={input}
                      placeholder="Valeur initiale"
                      value={row.initial ?? ""}
                      onChange={(e) => set({ initial: e.target.value })}
                    />
                    <input
                      className={`${input} font-sans`}
                      placeholder="Commentaire"
                      value={row.comment ?? ""}
                      onChange={(e) => set({ comment: e.target.value })}
                    />
                    <button
                      type="button"
                      title="Supprimer la ligne"
                      onClick={() =>
                        update(
                          key,
                          value[key].filter((_, j) => j !== i),
                        )
                      }
                      className="px-2 text-slate-500 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
