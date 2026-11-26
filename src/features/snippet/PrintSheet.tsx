import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { parseLadder } from "../../core/ladder/parse";
import { INTERFACE_SECTIONS, LANG_LABELS, type Snippet } from "../../core/snippet/schema";
import { LadderDiagram } from "../ladder/LadderDiagram";

/*
 * Fiche d'impression d'un snippet (et PDF : « Microsoft Print to PDF » dans la fenêtre
 * d'impression de Windows). Rendue hors de l'application, seule visible à l'impression
 * (voir @media print dans styles.css), en thème clair le temps de l'impression.
 */

const th = "border border-gray-300 bg-gray-100 px-2 py-1 text-left font-semibold";
const td = "border border-gray-300 px-2 py-1 align-top";

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full border-collapse text-[9pt]">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.join("\u0000")}>
            {r.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: colonnes fixes
              <td key={i} className={`${td} ${i < 3 ? "font-mono" : ""}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="print-avoid-break space-y-1.5">
      <h2 className="border-b border-gray-400 pb-0.5 text-[11pt] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function PrintSheet({ snippet }: { snippet: Snippet }) {
  const { meta } = snippet;
  const lad = snippet.variants.find((v) => v.lang === "LAD");
  const program = useMemo(() => {
    const r = lad?.content.trim() ? parseLadder(lad.content) : null;
    return r?.ok ? r.program : null;
  }, [lad]);
  const variables = INTERFACE_SECTIONS.flatMap(({ key, label }) =>
    meta.interface[key].map((v) => [v.name, v.type, v.initial ?? "", label, v.comment ?? ""]),
  );

  return (
    <div className="space-y-4 bg-white text-[10pt] text-black">
      <header className="space-y-1">
        <h1 className="text-[16pt] font-bold">{meta.title}</h1>
        {meta.summary && <p>{meta.summary}</p>}
        <p className="text-[9pt] text-gray-600">
          {[
            meta.blockType,
            meta.cpuFamilies.join(", "),
            meta.tiaVersion ? `TIA ${meta.tiaVersion}` : "",
            meta.tags.map((t) => `#${t}`).join(" "),
            `modifié le ${new Date(meta.updatedAt).toLocaleDateString("fr-FR")}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {program && (
        <Section title="Schéma LADDER">
          <div className="print-diagram">
            <LadderDiagram program={program} />
          </div>
        </Section>
      )}

      {variables.length > 0 && (
        <Section title="Interface">
          <Table head={["Nom", "Type", "Valeur initiale", "Section", "Commentaire"]} rows={variables} />
        </Section>
      )}
      {meta.plcTags.length > 0 && (
        <Section title="Variables API">
          <Table
            head={["Nom", "Type", "Adresse", "Commentaire"]}
            rows={meta.plcTags.map((t) => [t.name, t.type, t.address ?? "auto (%M)", t.comment ?? ""])}
          />
        </Section>
      )}

      {snippet.variants.map((v) => (
        <section key={v.lang} className="space-y-1.5">
          <h2 className="border-b border-gray-400 pb-0.5 text-[11pt] font-semibold">
            {LANG_LABELS[v.lang]}
            {v.generated && <span className="font-normal text-gray-600"> (généré depuis le LADDER)</span>}
            <span className="font-mono text-[9pt] font-normal text-gray-600"> — {v.file}</span>
          </h2>
          <pre className="whitespace-pre-wrap break-words rounded border border-gray-300 p-2 font-mono text-[8.5pt] leading-snug">
            {v.content}
          </pre>
        </section>
      ))}

      {snippet.readme && (
        <Section title="Notes">
          <div className="whitespace-pre-wrap">{snippet.readme}</div>
        </Section>
      )}

      <footer className="text-[8pt] text-gray-500">PLC Snippets · {snippet.id}</footer>
    </div>
  );
}

/**
 * Imprime la fiche : thème clair le temps de l'impression, puis retour à l'état
 * d'origine quand la fenêtre d'impression se ferme.
 */
export function PrintPortal({ snippet, onDone }: { snippet: Snippet; onDone: () => void }) {
  useEffect(() => {
    const root = document.documentElement;
    const theme = root.dataset.theme;
    root.dataset.theme = "light";
    window.addEventListener("afterprint", onDone, { once: true });
    // Laisse le temps au navigateur d'appliquer le thème et de dessiner la fiche.
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => window.print());
    });
    // Fin de l'impression (ou démontage) : thème d'origine.
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", onDone);
      if (theme === undefined) delete root.dataset.theme;
      else root.dataset.theme = theme;
    };
  }, [onDone]);

  return createPortal(
    <div id="print-root">
      <PrintSheet snippet={snippet} />
    </div>,
    document.body,
  );
}
