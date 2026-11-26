import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { mergeTags, readTagsWorkbook } from "../../core/io/plc-tags-xlsx";
import type { PlcTag } from "../../core/snippet/schema";
import { readImportSource } from "../../storage/transfer";

/**
 * Importe des variables API depuis un .xlsx exporté de TIA (Variables API → Exporter)
 * ou par PLC Snippets. Les variables déjà déclarées sont gardées.
 */
export function ImportTagsButton({
  value,
  onChange,
}: {
  value: PlcTag[];
  onChange: (tags: PlcTag[]) => void;
}) {
  const [report, setReport] = useState<{ tone: "ok" | "error"; lines: string[] } | null>(null);

  const pick = async () => {
    const path = await open({
      title: "Importer une table de variables API",
      filters: [{ name: "Table de variables TIA", extensions: ["xlsx"] }],
    });
    if (typeof path !== "string") return;
    try {
      const { tags, warnings } = readTagsWorkbook((await readImportSource(path)).files);
      const merged = mergeTags(value, tags);
      onChange(merged.tags);
      setReport({
        tone: "ok",
        lines: [
          `${merged.added} variable${merged.added > 1 ? "s" : ""} ajoutée${merged.added > 1 ? "s" : ""}.`,
          ...(merged.completed.length > 0
            ? [`Adresse ou commentaire complétés : ${merged.completed.join(", ")}.`]
            : []),
          ...(merged.kept.length > 0 ? [`Déjà déclarées, inchangées : ${merged.kept.join(", ")}.`] : []),
          ...warnings,
        ],
      });
    } catch (e) {
      setReport({ tone: "error", lines: [e instanceof Error ? e.message : String(e)] });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={pick}
        title="Variables API d'une table exportée de TIA (.xlsx)"
        className="text-xs text-sky-400 hover:underline"
      >
        Importer .xlsx
      </button>
      {report && (
        <div
          role="status"
          className={`w-full rounded-md border p-2 text-xs ${
            report.tone === "ok"
              ? "border-emerald-800 bg-emerald-950/40 text-emerald-200"
              : "border-red-800 bg-red-950/40 text-red-200"
          }`}
        >
          {report.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <button
            type="button"
            onClick={() => setReport(null)}
            className="mt-1 text-slate-400 hover:underline"
          >
            OK
          </button>
        </div>
      )}
    </>
  );
}
