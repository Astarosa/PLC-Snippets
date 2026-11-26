import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { Badge } from "../../components/Badge";
import { checkSnippetLadder, errorsOf } from "../../core/ladder/check";
import { relativeDate } from "../../core/snippet/filter";
import { LANG_SHORT, type Snippet } from "../../core/snippet/schema";
import { useSettings } from "../../state/settings";
import { useCreateSamples, useLibrary } from "../../storage/queries";
import { ImportButton } from "../transfer/ImportButton";

const LANG_TONE = { LAD: "lad", SCL: "scl", STL: "stl" } as const;

const SHORTCUTS: [string, string][] = [
  ["Ctrl+N", "Nouveau snippet"],
  ["Ctrl+F", "Rechercher"],
  ["Ctrl+S", "Enregistrer"],
  ["Ctrl+D", "Dupliquer le snippet ouvert"],
  ["Suppr", "Effacer l'élément LADDER sélectionné"],
  ["Échap", "Désélectionner"],
];

const button =
  "rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50";

export function Welcome() {
  const libraryPath = useSettings((s) => s.libraryPath);
  const chooseLibrary = useSettings((s) => s.chooseLibrary);
  const { data } = useLibrary();
  const createSamples = useCreateSamples();

  if (!libraryPath) {
    return (
      <Centered title="Bienvenue">
        <p>
          Ta bibliothèque est un simple dossier : un sous-dossier par snippet. Mets-le par exemple dans ton
          Nextcloud pour le synchroniser entre tes PC.
        </p>
        <button type="button" className={button} onClick={chooseLibrary}>
          Choisir le dossier de la bibliothèque
        </button>
      </Centered>
    );
  }

  const empty = data && data.snippets.length === 0 && data.invalid.length === 0;
  if (empty) {
    return (
      <Centered title="Bibliothèque vide">
        <p>Crée ton premier snippet, ou ajoute quelques exemples pour voir le format sur le disque.</p>
        <Link to="/new" className={`${button} inline-block`}>
          + Nouveau snippet
        </Link>
        <button
          type="button"
          className="ml-2 rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          disabled={createSamples.isPending}
          onClick={() => createSamples.mutate()}
        >
          Créer les exemples
        </button>
        {createSamples.error && <p className="text-red-400">{String(createSamples.error)}</p>}
      </Centered>
    );
  }

  return <Dashboard snippets={data?.snippets ?? []} libraryPath={libraryPath} />;
}

/** Ce qui bloquerait ou fragiliserait l'export d'un snippet vers TIA. */
function exportIssue(snippet: Snippet): { tone: "error" | "warning"; label: string; detail: string } | null {
  const diags = checkSnippetLadder(snippet);
  const errors = errorsOf(diags);
  if (errors.length > 0)
    return {
      tone: "error",
      label: `⛔ ${errors.length} erreur${errors.length > 1 ? "s" : ""}`,
      detail: errors[0].message,
    };
  const tags = diags.find((d) => d.fix === "declare-tags");
  if (tags)
    return { tone: "warning", label: "⚠ Variables API", detail: tags.message.replace(/\. Sans.*$/, ".") };
  return null;
}

function Dashboard({ snippets, libraryPath }: { snippets: Snippet[]; libraryPath: string }) {
  const recent = useMemo(
    () => [...snippets].sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt)).slice(0, 6),
    [snippets],
  );
  const issues = useMemo(
    () =>
      snippets
        .map((s) => ({ snippet: s, issue: exportIssue(s) }))
        .filter(
          (x): x is { snippet: Snippet; issue: NonNullable<ReturnType<typeof exportIssue>> } => !!x.issue,
        )
        .sort((a, b) => (a.issue.tone === b.issue.tone ? 0 : a.issue.tone === "error" ? -1 : 1)),
    [snippets],
  );
  const heading = "text-xs font-semibold uppercase tracking-wide text-slate-400";

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <header className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold text-slate-100">Bibliothèque</h2>
          <p className="text-sm text-slate-400">
            {snippets.length} snippet{snippets.length > 1 ? "s" : ""} · dossier{" "}
            <span className="font-mono">{libraryPath}</span>
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link to="/new" className={`${button} flex items-center gap-2`}>
            + Nouveau snippet
            <kbd className="rounded bg-white/20 px-1.5 font-mono text-[11px]">Ctrl+N</kbd>
          </Link>
          <ImportButton disabled={false} />
        </div>
      </header>

      <section className="space-y-3">
        <h3 className={heading}>Derniers modifiés</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {recent.map((s) => (
            <Link
              key={s.id}
              to="/snippets/$snippetId"
              params={{ snippetId: s.id }}
              className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"
            >
              <span className="font-medium text-slate-100">{s.meta.title}</span>
              {s.meta.summary && (
                <span className="line-clamp-2 text-sm text-slate-400">{s.meta.summary}</span>
              )}
              <span className="mt-auto flex flex-wrap items-center gap-1">
                {s.variants.map((v) => (
                  <Badge key={v.lang} tone={LANG_TONE[v.lang]}>
                    {LANG_SHORT[v.lang]}
                  </Badge>
                ))}
                <Badge>{s.meta.blockType}</Badge>
                <span className="ml-auto text-xs text-slate-400">{relativeDate(s.meta.updatedAt)}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {issues.length > 0 && (
        <section className="space-y-3">
          <h3 className={heading}>À vérifier avant export</h3>
          <ul className="space-y-1.5">
            {issues.map(({ snippet, issue }) => (
              <li key={snippet.id}>
                <Link
                  to="/snippets/$snippetId/edit"
                  params={{ snippetId: snippet.id }}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2.5 text-sm ${issue.tone === "error" ? "border-red-900 bg-red-950/40" : "border-amber-900 bg-amber-950/30"}`}
                >
                  <span className={issue.tone === "error" ? "text-red-300" : "text-amber-300"}>
                    {issue.label}
                  </span>
                  <span className="text-slate-100">{snippet.meta.title}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-400">{issue.detail}</span>
                  <span className="text-sky-400">{issue.tone === "error" ? "Corriger →" : "Déclarer →"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h3 className={heading}>Raccourcis</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2 text-sm text-slate-300">
          {SHORTCUTS.map(([key, label]) => (
            <span key={key}>
              <kbd className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-200">
                {key}
              </kbd>
              {label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function Centered({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center text-sm text-slate-400">
        <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
        {children}
      </div>
    </div>
  );
}
