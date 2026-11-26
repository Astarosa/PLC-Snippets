import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../../components/Badge";
import { CollapseIcon, HomeIcon } from "../../components/icons";
import { ThemeToggle } from "../../components/ThemeToggle";
import { APP_VERSION } from "../../core/app-version";
import { checkSnippetLadder, errorsOf } from "../../core/ladder/check";
import { filterSnippets, hasFilters, tagCounts } from "../../core/snippet/filter";
import { moveId } from "../../core/snippet/order";
import { BLOCK_TYPES, LANG_SHORT, LANGS, type Lang } from "../../core/snippet/schema";

const LANG_TONE = { LAD: "lad", SCL: "scl", STL: "stl" } as const satisfies Record<Lang, string>;
const LANG_CHIP: Record<Lang, string> = {
  LAD: "text-emerald-300",
  SCL: "text-sky-300",
  STL: "text-violet-300",
};
/** Tags visibles avant « +N ». */
const TAGS_SHOWN = 4;

import { useLibraryFilters } from "../../state/library-filters";
import { useSettings } from "../../state/settings";
import { useLibrary, useReorder } from "../../storage/queries";
import { ExportMenu, type ExportStatus, StatusLine } from "../transfer/ExportMenu";
import { ImportButton } from "../transfer/ImportButton";

/** Glisser vertical d'un snippet : position d'origine et point d'insertion (0..n). */
interface ListDrag {
  from: number;
  startY: number;
  active: boolean;
  insertAt: number | null;
}

/** Pastille de filtre : cochée = fond bleu. */
function Chip({
  on,
  onClick,
  children,
  tone = "text-slate-300",
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-sky-600 bg-sky-950 text-sky-100" : `border-slate-700 hover:border-slate-500 ${tone}`}`}
    >
      {children}
    </button>
  );
}

export function Sidebar({ onCollapse }: { onCollapse?: () => void } = {}) {
  const libraryPath = useSettings((s) => s.libraryPath);
  const chooseLibrary = useSettings((s) => s.chooseLibrary);
  const { data, isLoading, error, refetch, isFetching } = useLibrary();
  const filters = useLibraryFilters();
  const { query, setQuery } = filters;
  const [allTags, setAllTags] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  // Ctrl+F (ou la loupe du rail) : focus sur la recherche, dès que le champ est affiché.
  const { searchFocusPending, searchFocused } = filters;
  useEffect(() => {
    if (!searchFocusPending || !search.current) return;
    search.current.focus();
    searchFocused();
  }, [searchFocusPending, searchFocused]);

  const visible = useMemo(() => filterSnippets(data?.snippets ?? [], filters), [data, filters]);
  const tags = useMemo(() => tagCounts(data?.snippets ?? []), [data]);
  /** Nombre d'erreurs LADDER par snippet (bloquantes pour l'export TIA). */
  const errorCount = useMemo(
    () => new Map((data?.snippets ?? []).map((s) => [s.id, errorsOf(checkSnippetLadder(s)).length])),
    [data],
  );
  const filtered = hasFilters(filters);
  const reorder = useReorder();
  const [drag, setDrag] = useState<ListDrag | null>(null);
  const canReorder = !filtered;
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedSnippets = (data?.snippets ?? []).filter((s) => selected.has(s.id));

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
        <div className="flex items-center gap-1">
          <h1 className="text-sm font-semibold tracking-wide text-slate-100">
            {/* Le titre ramène à l'accueil (derniers modifiés, à vérifier, raccourcis). */}
            <Link
              to="/"
              title="Accueil"
              className="flex items-baseline gap-2 rounded px-1 -mx-1 hover:bg-slate-800"
              activeOptions={{ exact: true }}
              activeProps={{ "aria-current": "page" }}
            >
              PLC Snippets
              <span className="font-mono text-[11px] font-normal tracking-normal text-slate-500">
                {APP_VERSION}
              </span>
            </Link>
          </h1>
          <Link
            to="/"
            aria-label="Accueil"
            title="Accueil"
            activeOptions={{ exact: true }}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-100 [&.active]:text-sky-300"
          >
            <HomeIcon />
          </Link>
          <ThemeToggle className="ml-auto" />
          {onCollapse && (
            <button
              type="button"
              aria-label="Replier la bibliothèque"
              title="Replier la bibliothèque"
              onClick={onCollapse}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            >
              <CollapseIcon />
            </button>
          )}
        </div>
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
        <div className="flex gap-2">
          <Link
            to="/new"
            disabled={!libraryPath}
            className="block flex-1 rounded-md bg-sky-600 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-sky-500 aria-disabled:pointer-events-none aria-disabled:opacity-40"
          >
            + Nouveau snippet
          </Link>
          <ImportButton disabled={!libraryPath} />
        </div>
        <div className="relative">
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher (titre, tag, code)…"
            aria-label="Rechercher"
            disabled={!libraryPath}
            className="w-full rounded-md border border-slate-700 bg-slate-950 py-1.5 pr-14 pl-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none"
          />
          <kbd className="pointer-events-none absolute top-1.5 right-2 rounded bg-slate-800 px-1.5 font-mono text-[11px] text-slate-400">
            Ctrl+F
          </kbd>
        </div>
        {(data?.snippets.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-start gap-1">
              <span className="w-16 shrink-0 pt-0.5 text-[11px] text-slate-400">Bloc</span>
              <div className="flex flex-1 flex-wrap gap-1">
                {BLOCK_TYPES.map((b) => (
                  <Chip
                    key={b}
                    on={filters.blockTypes.includes(b)}
                    onClick={() => filters.toggleBlockType(b)}
                  >
                    {b}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-1">
              <span className="w-16 shrink-0 pt-0.5 text-[11px] text-slate-400">Langage</span>
              <div className="flex flex-1 flex-wrap gap-1">
                {LANGS.map((l) => (
                  <Chip
                    key={l}
                    on={filters.langs.includes(l)}
                    onClick={() => filters.toggleLang(l)}
                    tone={LANG_CHIP[l]}
                  >
                    {LANG_SHORT[l]}
                  </Chip>
                ))}
              </div>
            </div>
            {tags.length > 0 && (
              <div className="flex items-start gap-1">
                <span className="w-16 shrink-0 pt-0.5 text-[11px] text-slate-400">Tags</span>
                <div className="flex flex-1 flex-wrap gap-1">
                  {(allTags ? tags : tags.slice(0, TAGS_SHOWN)).map(({ tag }) => (
                    <Chip
                      key={tag}
                      on={filters.tags.some((t) => t.toLowerCase() === tag.toLowerCase())}
                      onClick={() => filters.toggleTag(tag)}
                      tone="text-amber-300"
                    >
                      #{tag}
                    </Chip>
                  ))}
                  {tags.length > TAGS_SHOWN && (
                    <button
                      type="button"
                      onClick={() => setAllTags(!allTags)}
                      className="px-1 text-xs text-sky-400 hover:underline"
                    >
                      {allTags ? "moins" : `+${tags.length - TAGS_SHOWN}`}
                    </button>
                  )}
                </div>
              </div>
            )}
            {filtered && (
              <div className="flex items-center text-xs text-slate-400">
                {visible.length} résultat{visible.length > 1 ? "s" : ""}
                <button
                  type="button"
                  onClick={filters.clear}
                  className="ml-auto text-sky-400 hover:underline"
                >
                  Tout effacer
                </button>
              </div>
            )}
          </div>
        )}
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
                {selecting ? (
                  <input
                    type="checkbox"
                    aria-label={`Sélectionner ${s.meta.title}`}
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="mx-1 shrink-0"
                  />
                ) : (
                  <button
                    type="button"
                    aria-label={`Déplacer ${s.meta.title}`}
                    title={canReorder ? "Glisser pour réordonner" : "Efface les filtres pour réordonner"}
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
                )}
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
                    {(errorCount.get(s.id) ?? 0) > 0 && (
                      <span
                        className="ml-auto text-[11px] text-red-300"
                        title="Erreurs LADDER : l'export TIA est bloqué"
                      >
                        ⛔ {errorCount.get(s.id)}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        {reorder.error && (
          <p className="p-2 text-xs text-red-400">Ordre non enregistré : {String(reorder.error)}</p>
        )}

        {data && filtered && visible.length === 0 && (
          <p className="p-2 text-sm text-slate-500">Aucun snippet ne correspond aux filtres.</p>
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

      {libraryPath && (data?.snippets.length ?? 0) > 0 && (
        <footer className="space-y-2 border-t border-slate-800 p-3">
          {selecting ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    selected.size === visible.length ? new Set() : new Set(visible.map((s) => s.id)),
                  )
                }
                className="text-xs text-sky-400 hover:underline"
              >
                {selected.size === visible.length ? "Aucun" : "Tout"}
              </button>
              <span className="text-xs text-slate-400">
                {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <ExportMenu
                  snippets={selectedSnippets}
                  onStatus={setExportStatus}
                  align="left"
                  direction="up"
                  label="Exporter"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelecting(false);
                    setSelected(new Set());
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Fermer
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSelecting(true)}
              className="text-xs text-sky-400 hover:underline"
            >
              Sélectionner pour exporter plusieurs snippets…
            </button>
          )}
          <StatusLine status={exportStatus} onClose={() => setExportStatus(null)} />
        </footer>
      )}
    </aside>
  );
}
