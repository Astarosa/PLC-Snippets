import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { matchesQuery } from "../../core/snippet/parse";
import { LANG_SHORT, type Lang } from "../../core/snippet/schema";

const LANG_TONE = { LAD: "lad", SCL: "scl", STL: "stl" } as const satisfies Record<Lang, string>;

import { useSettings } from "../../state/settings";
import { useLibrary } from "../../storage/queries";

export function Sidebar() {
  const libraryPath = useSettings((s) => s.libraryPath);
  const chooseLibrary = useSettings((s) => s.chooseLibrary);
  const { data, isLoading, error, refetch, isFetching } = useLibrary();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => (data?.snippets ?? []).filter((s) => matchesQuery(s, query)), [data, query]);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <header className="space-y-2 border-b border-slate-800 p-3">
        <h1 className="text-sm font-semibold tracking-wide text-slate-100">PLC Snippets</h1>
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[11px] text-slate-500" title={libraryPath ?? ""}>
            {libraryPath ?? "Aucune bibliothèque"}
          </span>
          <button
            type="button"
            onClick={chooseLibrary}
            className="ml-auto shrink-0 text-[11px] text-sky-400 hover:underline"
          >
            Changer
          </button>
          {libraryPath && (
            <button
              type="button"
              onClick={() => refetch()}
              title="Relire le dossier"
              className="shrink-0 text-[11px] text-sky-400 hover:underline"
            >
              {isFetching ? "…" : "Actualiser"}
            </button>
          )}
        </div>
        <Link
          to="/new"
          disabled={!libraryPath}
          className="block rounded-md bg-sky-600 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-sky-500 aria-disabled:pointer-events-none aria-disabled:opacity-40"
        >
          + Nouveau snippet
        </Link>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher (titre, tag, code)…"
          disabled={!libraryPath}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none"
        />
      </header>

      <nav className="flex-1 overflow-y-auto p-2">
        {isLoading && <p className="p-2 text-sm text-slate-500">Lecture de la bibliothèque…</p>}
        {error && <p className="p-2 text-sm text-red-400">{String(error)}</p>}

        <ul className="space-y-1">
          {visible.map((s) => (
            <li key={s.id}>
              <Link
                to="/snippets/$snippetId"
                params={{ snippetId: s.id }}
                className="block rounded-md px-2.5 py-2 hover:bg-slate-800"
                activeProps={{ className: "bg-slate-800 ring-1 ring-slate-700" }}
              >
                <div className="text-sm text-slate-100">{s.meta.title}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.variants.map((v) => (
                    <Badge key={v.lang} tone={LANG_TONE[v.lang]}>
                      {LANG_SHORT[v.lang]}
                    </Badge>
                  ))}
                  <Badge>{s.meta.blockType}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {data && query && visible.length === 0 && (
          <p className="p-2 text-sm text-slate-500">Aucun résultat pour « {query} ».</p>
        )}

        {data && data.invalid.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-red-400">
              Snippets illisibles ({data.invalid.length})
            </p>
            {data.invalid.map((inv) => (
              <div key={inv.id} className="rounded-md bg-red-950/40 px-2.5 py-2 text-xs">
                <div className="font-mono text-red-300">{inv.id}/</div>
                <ul className="mt-1 list-disc pl-4 text-red-200/80">
                  {inv.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </nav>
    </aside>
  );
}
