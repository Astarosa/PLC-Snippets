import { INTERFACE_SECTIONS, type SnippetInterface } from "../../core/snippet/schema";

export function InterfaceTable({ iface }: { iface: SnippetInterface }) {
  const sections = INTERFACE_SECTIONS.filter((s) => iface[s.key].length > 0);
  if (sections.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Interface</h3>
      <div className="overflow-hidden rounded-lg border border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-xs text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">Nom</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Valeur initiale</th>
              <th className="px-3 py-2 font-medium">Commentaire</th>
            </tr>
          </thead>
          {sections.map((section) => (
            <tbody key={section.key} className="divide-y divide-slate-800">
              <tr className="bg-slate-900/60">
                <td colSpan={4} className="px-3 py-1 text-[11px] font-semibold text-sky-300">
                  {section.label}
                </td>
              </tr>
              {iface[section.key].map((v) => (
                <tr key={v.name} className="text-slate-200">
                  <td className="px-3 py-1.5 font-mono text-[13px]">{v.name}</td>
                  <td className="px-3 py-1.5 font-mono text-[13px] text-emerald-300">{v.type}</td>
                  <td className="px-3 py-1.5 font-mono text-[13px] text-slate-400">{v.initial ?? ""}</td>
                  <td className="px-3 py-1.5 text-slate-400">{v.comment ?? ""}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
