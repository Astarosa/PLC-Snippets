import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { Badge } from "../../components/Badge";
import { CodeBlock } from "../../components/CodeBlock";
import { LANG_LABELS, type Lang } from "../../core/snippet/schema";
import { useDeleteSnippet, useSnippet } from "../../storage/queries";
import { LadderPreview } from "../ladder/LadderPreview";
import { ExportPanel } from "./ExportPanel";
import { InterfaceTable } from "./InterfaceTable";
import { StlView } from "./StlView";

export function SnippetPage() {
  const { snippetId } = useParams({ from: "/snippets/$snippetId" });
  const { snippet, isLoading } = useSnippet(snippetId);
  const [tab, setTab] = useState<Lang>("LAD");
  const navigate = useNavigate();
  const deleteSnippet = useDeleteSnippet();
  const [exporting, setExporting] = useState(false);

  // Revient sur le premier onglet disponible quand on change de snippet.
  useEffect(() => {
    if (snippet) setTab(snippet.variants[0].lang);
  }, [snippet]);

  if (isLoading) return <p className="p-6 text-sm text-slate-500">Chargement…</p>;
  if (!snippet) return <p className="p-6 text-sm text-red-400">Snippet « {snippetId} » introuvable.</p>;

  const { meta } = snippet;
  const variant = snippet.variants.find((v) => v.lang === tab) ?? snippet.variants[0];

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
      <header className="space-y-2">
        <div className="flex items-start gap-3">
          <h2 className="text-2xl font-semibold text-slate-100">{meta.title}</h2>
          <div className="ml-auto flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setExporting((e) => !e)}
              className="rounded-md border border-sky-800 px-3 py-1 text-sm text-sky-200 hover:bg-sky-950"
            >
              Exporter
            </button>
            <Link
              to="/snippets/$snippetId/edit"
              params={{ snippetId: snippet.id }}
              className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
            >
              Modifier
            </Link>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleteSnippet.isPending}
              className="rounded-md border border-red-900 px-3 py-1 text-sm text-red-300 hover:bg-red-950"
            >
              Supprimer
            </button>
          </div>
        </div>
        {deleteSnippet.error && <p className="text-sm text-red-400">{String(deleteSnippet.error)}</p>}
        {meta.summary && <p className="text-sm text-slate-400">{meta.summary}</p>}
        <div className="flex flex-wrap gap-1.5">
          <Badge>{meta.blockType}</Badge>
          {meta.cpuFamilies.map((c) => (
            <Badge key={c}>{c}</Badge>
          ))}
          {meta.tiaVersion && <Badge>TIA {meta.tiaVersion}</Badge>}
          {meta.tags.map((t) => (
            <Badge key={t} tone="tag">
              #{t}
            </Badge>
          ))}
        </div>
      </header>

      {exporting && <ExportPanel key={snippet.id} snippet={snippet} onClose={() => setExporting(false)} />}

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
        {variant.lang === "LAD" && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/60">
            <LadderPreview source={variant.content} />
          </div>
        )}
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

      <InterfaceTable iface={meta.interface} />

      {snippet.readme && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</h3>
          <div className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm leading-6 text-slate-300">
            {snippet.readme}
          </div>
        </section>
      )}

      <footer className="text-[11px] text-slate-600">
        Modifié le {new Date(meta.updatedAt).toLocaleString("fr-FR")} · dossier <code>{snippet.id}/</code>
      </footer>
    </article>
  );
}
