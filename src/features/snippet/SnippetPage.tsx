import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge } from "../../components/Badge";
import { CodeBlock } from "../../components/CodeBlock";
import type { Lang } from "../../core/snippet/schema";
import { useSnippet } from "../../storage/queries";
import { InterfaceTable } from "./InterfaceTable";

export function SnippetPage() {
  const { snippetId } = useParams({ from: "/snippets/$snippetId" });
  const { snippet, isLoading } = useSnippet(snippetId);
  const [tab, setTab] = useState<Lang>("LAD");

  // Revient sur le premier onglet disponible quand on change de snippet.
  useEffect(() => {
    if (snippet) setTab(snippet.variants[0].lang);
  }, [snippet]);

  if (isLoading) return <p className="p-6 text-sm text-slate-500">Chargement…</p>;
  if (!snippet) return <p className="p-6 text-sm text-red-400">Snippet « {snippetId} » introuvable.</p>;

  const { meta } = snippet;
  const variant = snippet.variants.find((v) => v.lang === tab) ?? snippet.variants[0];

  return (
    <article className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-100">{meta.title}</h2>
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
              {v.lang === "LAD" ? "LADDER" : "SCL"}
              {v.generated && <span className="ml-1 text-[10px] text-slate-500">(généré)</span>}
            </button>
          ))}
        </div>
        <CodeBlock code={variant.content} title={variant.file} />
        {variant.lang === "LAD" && (
          <p className="text-xs text-slate-500">
            Source DSL du LADDER. Le rendu graphique arrive à l'étape 4 de la feuille de route.
          </p>
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
