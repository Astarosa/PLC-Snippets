import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { moveId } from "../../core/snippet/order";
import { matchesQuery } from "../../core/snippet/parse";
import { LANG_SHORT, type Lang } from "../../core/snippet/schema";

const LANG_TONE = { LAD: "lad", SCL: "scl", STL: "stl" } as const satisfies Record<Lang, string>;

import { useSettings } from "../../state/settings";
import { useLibrary, useReorder } from "../../storage/queries";

/** Glisser vertical d'un snippet : position d'origine et point d'insertion (0..n). */
interface ListDrag {
  from: number;
  startY: number;
  active: boolean;
  insertAt: number | null;
}

export function Sidebar() {
  const libraryPath = useSettings((s) => s.libraryPath);
  const chooseLibrary = useSettings((s) => s.chooseLibrary);
  const { data, isLoading, error, refetch, isFetching } = useLibrary();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => (data?.snippets ?? []).filter((s) => matchesQuery(s, query)), [data, query]);
  const reorder = useReorder();
  const [drag, setDrag] = useState<ListDrag | null>(null);
  const canReorder = query.trim() === "";

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const active = drag.active || Math.abs(e.clientY - drag.startY) > 4;
      let insertAt: number | null = null;
      const item = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-index]");
      if (item) {
        const index = Number(item.getAttribute("data-index"));
        const box = item.getBoundingClientRect();
        insertAt = e.clientY < box.top + box.height / 2 ? index : index + 1;
      }
      setDrag({ ...drag, active, insertAt });
    };
    const up = () => {
      if (drag.active && drag.insertAt !== null) {
        const to = drag.insertAt > drag.from ? drag.insertAt - 1 : drag.insertAt;
        if (to !== drag.from)
          reorder.mutate(
            moveId(
              visible.map((s) => s.id),
              drag.from,
              to,
            ),
          );
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, reorder, visible]);

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

        <ul className={`space-y-1 ${drag?.active ? "cursor-grabbing select-none" : ""}`}>
          {visible.map((s, i) => {
            const lineBefore = drag?.active && drag.insertAt === i && i !== drag.from && i !== drag.from + 1;
            const lineAfter =
              drag?.active && i === visible.length - 1 && drag.insertAt === visible.length && i !== drag.from;
            return (
              <li
                key={s.id}
                data-index={i}
                className={`group relative flex items-stretch ${drag?.active && drag.from === i ? "opacity-40" : ""}`}
              >
                {lineBefore && <div className="absolute -top-1 right-1 left-1 h-0.5 rounded bg-sky-400" />}
                {lineAfter && <div className="absolute right-1 -bottom-1 left-1 h-0.5 rounded bg-sky-400" />}
                <button
                  type="button"
                  aria-label={`Déplacer ${s.meta.title}`}
                  title={canReorder ? "Glisser pour réordonner" : "Vide la recherche pour réordonner"}
                  disabled={!canReorder}
                  onPointerDown={(e) => {
                    if (!canReorder) return;
                    e.preventDefault();
                    setDrag({ from: i, startY: e.clientY, active: false, insertAt: null });
                  }}
                  className="w-5 shrink-0 cursor-grab rounded-l-md text-center text-xs text-slate-600 opacity-0 group-hover:opacity-100 hover:text-slate-300 disabled:cursor-not-allowed"
                >
                  ⋮⋮
                </button>
                <Link
                  to="/snippets/$snippetId"
                  params={{ snippetId: s.id }}
                  className="block min-w-0 flex-1 rounded-md px-2 py-2 hover:bg-slate-800"
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
            );
          })}
        </ul>
        {reorder.error && (
          <p className="p-2 text-xs text-red-400">Ordre non enregistré : {String(reorder.error)}</p>
        )}

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
