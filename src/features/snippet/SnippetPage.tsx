import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ask } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "../../components/Badge";
import { CodeBlock } from "../../components/CodeBlock";
import { MoreMenu } from "../../components/MoreMenu";
import type { ExportFormat } from "../../core/export/source";
import { duplicateSnippet } from "../../core/snippet/duplicate";
import { relativeDate } from "../../core/snippet/filter";
import { LANG_LABELS, type Lang } from "../../core/snippet/schema";
import { useLibraryFilters } from "../../state/library-filters";
import { useSettings } from "../../state/settings";
import { openSnippetFolder } from "../../storage/folders";
import { useCreateSnippet, useDeleteSnippet, useLibrary, useSnippet } from "../../storage/queries";
import { LadderView } from "../ladder/LadderView";
import { useShortcut } from "../shortcuts";
import { ExportMenu, type ExportStatus, StatusLine } from "../transfer/ExportMenu";
import { ExportPanel } from "./ExportPanel";
import { InterfaceTable } from "./InterfaceTable";
import { PlcTagsTable } from "./PlcTagsTable";
import { PrintPortal } from "./PrintSheet";
import { StlView } from "./StlView";

export function SnippetPage() {
  const { snippetId } = useParams({ from: "/snippets/$snippetId" });
  const { snippet, isLoading } = useSnippet(snippetId);
  const [tab, setTab] = useState<Lang>("LAD");
  const [printing, setPrinting] = useState(false);
  const endPrint = useCallback(() => setPrinting(false), []);
  useShortcut("print", () => setPrinting(true));
  const navigate = useNavigate();
  const deleteSnippet = useDeleteSnippet();
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const { data: library } = useLibrary();
  const libraryPath = useSettings((s) => s.libraryPath);
  const createSnippet = useCreateSnippet();
  const showTag = useLibraryFilters((s) => s.showTag);
  const [notice, setNotice] = useState<string | null>(null);

  // Copie complète sous un nouvel identifiant, ouverte directement en modification.
  const duplicate = () => {
    if (!snippet || createSnippet.isPending) return;
    const raw = duplicateSnippet(snippet, library?.snippets.map((s) => s.id) ?? []);
    createSnippet.mutate(raw, {
      onSuccess: () => navigate({ to: "/snippets/$snippetId/edit", params: { snippetId: raw.id } }),
    });
  };
  useShortcut("duplicate", duplicate);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3000);
  };
  const copy = async (text: string, done: string) => {
    try {
      await writeText(text);
      flash(done);
    } catch {
      flash("Échec de la copie.");
    }
  };

  // Revient sur le premier onglet disponible quand on change de snippet.
  useEffect(() => {
    if (snippet) setTab(snippet.variants[0].lang);
  }, [snippet]);

  if (isLoading) return <p className="p-6 text-sm text-slate-500">Chargement…</p>;
  if (!snippet) return <p className="p-6 text-sm text-red-400">Snippet « {snippetId} » introuvable.</p>;

  const { meta } = snippet;
  const variant = snippet.variants.find((v) => v.lang === tab) ?? snippet.variants[0];
  const lad = snippet.variants.find((v) => v.lang === "LAD");

  const onDelete = async () => {
    const confirmed = await ask(
      `Supprimer « ${meta.title} » ?\n\nLe dossier ${snippet.id}/ sera effacé du disque.`,
      {
        title: "Supprimer le snippet",
        kind: "warning",
        okLabel: "Supprimer",
        cancelLabel: "Annuler",
      },
    );
    if (confirmed) deleteSnippet.mutate(snippet.id, { onSuccess: () => navigate({ to: "/" }) });
  };

  return (
    <article className="mx-auto max-w-5xl space-y-6 p-6">
      {printing && <PrintPortal snippet={snippet} onDone={endPrint} />}
      <header className="space-y-2">
        <div className="flex items-start gap-3">
          <h2 className="text-2xl font-semibold text-slate-100">{meta.title}</h2>
          <div className="ml-auto flex shrink-0 gap-2">
            <ExportMenu
              snippets={[snippet]}
              onStatus={setExportStatus}
              onPick={(id) => {
                // Sources TIA : panneau avec nom du bloc, mnémonique et aperçu.
                if (id === "tia-scl" || id === "tia-awl") {
                  setExporting(id === "tia-scl" ? "SCL" : "STL");
                  return true;
                }
                return false;
              }}
            />
            <Link
              to="/snippets/$snippetId/edit"
              params={{ snippetId: snippet.id }}
              className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
            >
              Modifier
            </Link>
            <MoreMenu
              items={[
                { label: "Dupliquer", hint: "Ctrl+D", onSelect: duplicate },
                { label: "Imprimer / PDF", hint: "Ctrl+P", onSelect: () => setPrinting(true) },
                ...(lad
                  ? [{ label: "Copier le LADDER", onSelect: () => copy(lad.content, "LADDER copié.") }]
                  : []),
                ...(libraryPath
                  ? [
                      {
                        label: "Ouvrir le dossier",
                        onSelect: () =>
                          openSnippetFolder(libraryPath, snippet.id).catch((e) => flash(String(e))),
                      },
                    ]
                  : []),
                { label: "Supprimer…", danger: true, separated: true, onSelect: onDelete },
              ]}
            />
          </div>
        </div>
        {deleteSnippet.error && <p className="text-sm text-red-400">{String(deleteSnippet.error)}</p>}
        {createSnippet.error && (
          <p className="text-sm text-red-400">Duplication impossible : {String(createSnippet.error)}</p>
        )}
        {notice && <p className="text-sm text-slate-300">{notice}</p>}
        {meta.summary && <p className="text-sm text-slate-400">{meta.summary}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{meta.blockType}</Badge>
          {meta.cpuFamilies.map((c) => (
            <Badge key={c}>{c}</Badge>
          ))}
          {meta.tiaVersion && <Badge>TIA {meta.tiaVersion}</Badge>}
          {meta.tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => showTag(t)}
              title="Filtrer la bibliothèque sur ce tag"
              className="rounded border border-amber-800 bg-amber-950/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-300 hover:underline"
            >
              #{t}
            </button>
          ))}
          <span
            className="ml-auto text-xs text-slate-400"
            title={new Date(meta.updatedAt).toLocaleString("fr-FR")}
          >
            Modifié {relativeDate(meta.updatedAt).replace(/^(\d)/, "le $1")}
          </span>
        </div>
      </header>

      <StatusLine status={exportStatus} onClose={() => setExportStatus(null)} />
      {exporting && (
        <ExportPanel
          key={`${snippet.id}-${exporting}`}
          snippet={snippet}
          initialFormat={exporting}
          onClose={() => setExporting(null)}
        />
      )}

      <section className="space-y-2">
        <div className="flex gap-1">
          {snippet.variants.map((v) => (
            <button
              key={v.lang}
              type="button"
              onClick={() => setTab(v.lang)}
              className={`rounded-t-md px-4 py-1.5 text-sm font-medium ${
                v.lang === variant.lang
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {LANG_LABELS[v.lang]}
              {v.generated && <span className="ml-1 text-[10px] text-slate-500">(généré)</span>}
            </button>
          ))}
        </div>
        {variant.lang === "LAD" && <LadderView key={snippet.id} source={variant.content} />}
        {variant.lang === "STL" ? (
          <StlView
            key={snippet.id}
            code={variant.content}
            file={variant.file}
            saved={variant.mnemonic ?? "DE"}
          />
        ) : (
          <CodeBlock
            code={variant.content}
            title={variant.file}
            language={variant.lang === "LAD" ? "lad" : "scl"}
          />
        )}
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(380px,1fr))] gap-6">
        <InterfaceTable iface={meta.interface} />
        <PlcTagsTable tags={meta.plcTags} />
      </div>

      {snippet.readme && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</h3>
          <div className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm leading-6 text-slate-300">
            {snippet.readme}
          </div>
        </section>
      )}

      <footer className="text-[11px] text-slate-500">
        Modifié le {new Date(meta.updatedAt).toLocaleString("fr-FR")} · dossier <code>{snippet.id}/</code>
      </footer>
    </article>
  );
}
