import type { PlcTag } from "../../core/snippet/schema";

/** Table des variables API d'un snippet (lecture seule). */
export function PlcTagsTable({ tags }: { tags: PlcTag[] }) {
  if (tags.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Variables API</h3>
      <div className="overflow-hidden rounded-lg border border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-xs text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">Nom</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Adresse</th>
              <th className="px-3 py-2 font-medium">Commentaire</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {tags.map((t) => (
              <tr key={t.name} className="text-slate-200">
                <td className="px-3 py-1.5 font-mono text-[13px]">{t.name}</td>
                <td className="px-3 py-1.5 font-mono text-[13px] text-emerald-300">{t.type}</td>
                <td className="px-3 py-1.5 font-mono text-[13px] text-sky-300">
                  {t.address ?? <span className="text-slate-600">auto (%M)</span>}
                </td>
                <td className="px-3 py-1.5 text-slate-400">{t.comment ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
