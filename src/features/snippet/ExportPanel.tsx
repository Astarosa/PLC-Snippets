import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { CodeBlock } from "../../components/CodeBlock";
import { availableFormats, buildSource, defaultBlockName, type ExportFormat } from "../../core/export/source";
import type { Snippet } from "../../core/snippet/schema";
import type { Mnemonic } from "../../core/stl/mnemonics";
import { MnemonicSwitch } from "./StlView";

const FORMAT_LABELS: Record<ExportFormat, string> = { SCL: "SCL (.scl)", STL: "LIST (.awl)" };

/** Export du snippet en source externe TIA : aperçu, copie, enregistrement. */
export function ExportPanel({ snippet, onClose }: { snippet: Snippet; onClose: () => void }) {
  const formats = availableFormats(snippet);
  const [format, setFormat] = useState<ExportFormat>(formats[0] ?? "SCL");
  const [blockName, setBlockName] = useState(defaultBlockName(snippet));
  const stlMnemonic = snippet.variants.find((v) => v.lang === "STL")?.mnemonic ?? "DE";
  const [mnemonic, setMnemonic] = useState<Mnemonic>(stlMnemonic);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const result = useMemo(
    () => buildSource(snippet, { format, blockName, mnemonic }),
    [snippet, format, blockName, mnemonic],
  );

  const saveFile = async () => {
    if (!result.ok) return;
    const ext = format === "SCL" ? "scl" : "awl";
    const path = await save({
      title: "Exporter la source TIA",
      defaultPath: result.fileName,
      filters: [{ name: FORMAT_LABELS[format], extensions: [ext] }],
    });
    if (!path) return;
    try {
      await invoke("export_source", { path, content: result.source });
      setStatus({ kind: "ok", text: `Exporté : ${path}` });
    } catch (e) {
      setStatus({ kind: "error", text: String(e) });
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-sky-900 bg-sky-950/20 p-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-100">Exporter en source externe TIA</h3>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-sm text-slate-400 hover:text-slate-200"
        >
          Fermer
        </button>
      </div>

      {formats.length === 0 ? (
        <p className="text-sm text-slate-400">Rien à exporter : ce snippet n'a ni SCL, ni LADDER, ni LIST.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <span className="mb-1 block text-xs text-slate-400">Format</span>
              <div className="flex gap-1">
                {formats.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    className={`rounded-md border px-3 py-1 text-sm ${
                      format === f
                        ? "border-sky-600 bg-sky-950 text-sky-200"
                        : "border-slate-700 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {FORMAT_LABELS[f]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="block-name" className="mb-1 block text-xs text-slate-400">
                Nom du bloc
              </label>
              <input
                id="block-name"
                value={blockName}
                onChange={(e) => setBlockName(e.target.value)}
                className="w-72 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-sm text-slate-100 focus:border-sky-600 focus:outline-none"
              />
            </div>
            {format === "STL" && (
              <div>
                <span className="mb-1 block text-xs text-slate-400">Mnémonique du projet TIA</span>
                <MnemonicSwitch value={mnemonic} onChange={setMnemonic} />
              </div>
            )}
            <button
              type="button"
              disabled={!result.ok}
              onClick={saveFile}
              className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Enregistrer le fichier…
            </button>
          </div>

          <p className="text-xs text-slate-500">
            {snippet.meta.blockType === "NETWORK"
              ? "Un réseau est exporté dans une FC sans interface : ses variables globales doivent exister dans l'API. "
              : ""}
            Dans TIA Portal : Sources externes → Ajouter un fichier → clic droit → Générer les blocs.
            {format === "STL" &&
              " La mnémonique doit correspondre au réglage du projet (Options → Paramètres)."}
          </p>

          {status && (
            <p className={`text-sm ${status.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>
              {status.text}
            </p>
          )}
          {result.ok ? (
            <CodeBlock
              code={result.source}
              title={result.fileName}
              language={format === "SCL" ? "scl" : "stl"}
            />
          ) : (
            <p className="rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
              {result.error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
