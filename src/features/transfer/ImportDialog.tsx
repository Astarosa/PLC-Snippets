import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";
import { Badge } from "../../components/Badge";
import { type ConflictChoice, planImport } from "../../core/io/apply";
import { LANG_SHORT } from "../../core/snippet/schema";
import { useImport } from "../../state/import";
import { useSettings } from "../../state/settings";
import { useLibrary } from "../../storage/queries";
import { tauriRepository as repo } from "../../storage/tauri-repository";

const CONFLICTS: { value: ConflictChoice; label: string }[] = [
  { value: "keep-both", label: "Garder les deux" },
  { value: "replace", label: "Remplacer le mien" },
  { value: "skip", label: "Ignorer" },
];

/** Dépôt de fichiers / dossiers depuis l'explorateur Windows, n'importe où sur la fenêtre. */
export function FileDropTarget() {
  const open = useImport((s) => s.open);
  const libraryPath = useSettings((s) => s.libraryPath);
  const [over, setOver] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const { type } = event.payload;
        if (type === "enter" || type === "over") setOver(true);
        else if (type === "leave") setOver(false);
        else if (type === "drop") {
          setOver(false);
          const [first] = event.payload.paths;
          if (first) open(first);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [open]);

  if (!over || !libraryPath) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70">
      <div className="rounded-xl border-2 border-dashed border-sky-400 bg-slate-900 px-10 py-8 text-center">
        <p className="text-lg font-semibold text-sky-200">Dépose pour importer</p>
        <p className="mt-1 text-sm text-slate-400">Zip ou dossier PLC Snippets, source TIA (.scl, .awl)</p>
      </div>
    </div>
  );
}

/** Aperçu de l'import : ce qui a été reconnu, ce qui sera perdu, doublons. */
export function ImportDialog() {
  const { loading, error, preview, choices, setChoice, close } = useImport();
  const { data } = useLibrary();
  const libraryPath = useSettings((s) => s.libraryPath);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!loading && !error && !preview) return null;

  // Les dossiers illisibles existent aussi sur le disque : ils comptent comme pris.
  const existing = [...(data?.snippets ?? []).map((s) => s.id), ...(data?.invalid ?? []).map((s) => s.id)];
  const plan = preview ? planImport(preview.items, existing, choices) : [];

  const confirm = async () => {
    if (!libraryPath || plan.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      for (const write of plan) {
        if (write.mode === "replace") await repo.write(libraryPath, write.raw);
        else await repo.create(libraryPath, write.raw);
      }
      await queryClient.invalidateQueries({ queryKey: ["library", libraryPath] });
      close();
      navigate({ to: "/snippets/$snippetId", params: { snippetId: plan[0].raw.id } });
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6">
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <header className="border-b border-slate-800 p-4">
          <h2 className="text-lg font-semibold text-slate-100">Importer des snippets</h2>
          {preview && (
            <p className="mt-1 text-sm text-slate-400">
              <span className="font-mono">{preview.sourceName}</span>
              {preview.format && (
                <>
                  {" · "}
                  {preview.format.label}{" "}
                  <span className={preview.format.lossless ? "text-emerald-400" : "text-amber-400"}>
                    ({preview.format.lossless ? "complet" : "passerelle avec perte"})
                  </span>
                </>
              )}
            </p>
          )}
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {loading && <p className="text-sm text-slate-400">Lecture…</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {preview?.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-300">
              {w}
            </p>
          ))}
          {preview?.items.map((item, i) => {
            const choice = choices[i];
            const conflict = existing.includes(item.id);
            const valid = item.snippet !== null;
            return (
              <div
                key={`${item.origin}-${item.id}`}
                className={`rounded-lg border p-3 ${valid ? "border-slate-700 bg-slate-950/40" : "border-red-900 bg-red-950/30"}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!valid}
                    checked={valid && choice?.include}
                    onChange={(e) => setChoice(i, { include: e.target.checked })}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-100">
                        {item.snippet?.meta.title ?? item.id}
                      </span>
                      {item.snippet?.variants.map((v) => (
                        <Badge key={v.lang}>{LANG_SHORT[v.lang]}</Badge>
                      ))}
                      {item.snippet && <Badge>{item.snippet.meta.blockType}</Badge>}
                    </div>
                    <p className="font-mono text-[11px] text-slate-500">
                      {item.origin} → {plan.find((p) => p.index === i)?.raw.id ?? item.id}/
                      {plan.find((p) => p.index === i)?.mode === "replace" && (
                        <span className="text-amber-400"> (remplace le tien)</span>
                      )}
                    </p>
                    {item.errors.map((e) => (
                      <p key={e} className="text-xs text-red-300">
                        {e}
                      </p>
                    ))}
                    {item.warnings.map((w) => (
                      <p key={w} className="text-xs text-amber-300">
                        {w}
                      </p>
                    ))}
                  </div>
                  {valid && conflict && choice?.include && (
                    <label className="shrink-0 text-xs text-slate-400">
                      Existe déjà :
                      <select
                        value={choice.conflict}
                        onChange={(e) => setChoice(i, { conflict: e.target.value as ConflictChoice })}
                        className="ml-2 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-slate-200"
                      >
                        {CONFLICTS.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <footer className="flex items-center gap-3 border-t border-slate-800 p-4">
          {saveError && <p className="flex-1 text-sm text-red-400">{saveError}</p>}
          <button
            type="button"
            onClick={close}
            className="ml-auto rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={plan.length === 0 || saving}
            onClick={confirm}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? "Import…" : `Importer ${plan.length} snippet${plan.length > 1 ? "s" : ""}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
