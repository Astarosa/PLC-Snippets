import { useEffect, useState } from "react";
import { addressProblem, canonicalAddress, findTag, type UsedGlobal } from "../../core/snippet/plc-tags";
import type { PlcTag } from "../../core/snippet/schema";

const field =
  "rounded border bg-slate-950 px-2 py-0.5 font-mono text-xs text-slate-100 focus:border-sky-600 focus:outline-none";

/**
 * Variables API de l'élément sélectionné : déclaration à la volée dans la table du snippet,
 * ou modification de leur type / adresse / commentaire si elles y sont déjà.
 */
export function TagQuickEdit({
  globals,
  tags,
  onChange,
}: {
  globals: UsedGlobal[];
  tags: PlcTag[];
  onChange: (tags: PlcTag[]) => void;
}) {
  if (globals.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 border-t border-slate-800 pt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Variables API</p>
      {globals.map((g) => (
        <TagRow key={g.name.toLowerCase()} used={g} tags={tags} onChange={onChange} />
      ))}
    </div>
  );
}

function TagRow({
  used,
  tags,
  onChange,
}: {
  used: UsedGlobal;
  tags: PlcTag[];
  onChange: (tags: PlcTag[]) => void;
}) {
  const existing = findTag(tags, used.name);
  const initial: PlcTag = existing ?? { name: used.name, type: used.type };
  const [draft, setDraft] = useState<PlcTag>(initial);
  // Resynchronise si la table change ailleurs (éditeur de table, autre élément).
  const signature = JSON.stringify(initial);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on ne recale que si la variable stockée change
  useEffect(() => setDraft(initial), [signature]);

  const problem = addressProblem(draft);
  const clean = (t: PlcTag): PlcTag => ({
    name: t.name,
    type: t.type.trim() || "Bool",
    ...(t.address?.trim() ? { address: canonicalAddress(t.address) } : {}),
    ...(t.comment?.trim() ? { comment: t.comment.trim() } : {}),
  });
  const save = () => {
    if (!existing) return;
    const next = clean(draft);
    if (JSON.stringify(next) === JSON.stringify(existing)) return;
    onChange(tags.map((t) => (t === existing ? next : t)));
  };
  const declare = () => onChange([...tags, clean(draft)]);
  const keys = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    // Entrée applique la ligne sans soumettre le formulaire du snippet.
    e.preventDefault();
    if (existing) save();
    else declare();
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-40 truncate font-mono text-xs text-slate-200" title={used.name}>
        "{used.name}"
      </span>
      <input
        className={`${field} w-20 border-slate-700`}
        value={draft.type}
        placeholder="Bool"
        onChange={(e) => setDraft({ ...draft, type: e.target.value })}
        onBlur={save}
        onKeyDown={keys}
      />
      <input
        className={`${field} w-24 ${problem ? "border-amber-600" : "border-slate-700"}`}
        value={draft.address ?? ""}
        placeholder="auto (%M)"
        title={problem ?? "Vide : adresse %M attribuée à l'export"}
        onChange={(e) => setDraft({ ...draft, address: e.target.value })}
        onBlur={save}
        onKeyDown={keys}
      />
      <input
        className={`${field} min-w-40 flex-1 border-slate-700 font-sans`}
        value={draft.comment ?? ""}
        placeholder="Commentaire"
        onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
        onBlur={save}
        onKeyDown={keys}
      />
      {existing ? (
        <span className="text-[11px] text-emerald-400">✓ dans la table</span>
      ) : (
        <button
          type="button"
          onClick={declare}
          className="rounded border border-amber-700 bg-amber-950/50 px-2 py-0.5 text-[11px] text-amber-200 hover:bg-amber-900/60"
        >
          Déclarer
        </button>
      )}
      {problem && <span className="w-full pl-40 text-[11px] text-amber-400">{problem}</span>}
    </div>
  );
}
