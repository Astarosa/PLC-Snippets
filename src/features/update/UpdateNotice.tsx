import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { formatBytes, progressPercent } from "./progress";

type State =
  | { step: "idle" }
  | { step: "available"; update: Update; current: string }
  | { step: "downloading"; update: Update; current: string; done: number; total: number | null }
  | { step: "installing"; update: Update; current: string }
  | { step: "error"; update: Update; current: string; message: string };

/**
 * À l'ouverture : vérifie s'il existe une release plus récente (latest.json de la dernière release
 * GitHub) et propose « Mettre à jour » ou « Plus tard ». « Plus tard » masque la notification
 * jusqu'au prochain lancement. Sans réseau ou hors Tauri, rien ne s'affiche.
 */
export function UpdateNotice() {
  const [state, setState] = useState<State>({ step: "idle" });
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await check();
        if (!update || cancelled) return;
        const current = await getVersion();
        setState({ step: "available", update, current });
      } catch (e) {
        console.warn("Vérification des mises à jour impossible :", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.step === "idle") return null;
  const { update, current } = state;

  const install = async () => {
    let done = 0;
    let total: number | null = null;
    setState({ step: "downloading", update, current, done, total });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? null;
        else if (event.event === "Progress") done += event.data.chunkLength;
        else if (event.event === "Finished") {
          setState({ step: "installing", update, current });
          return;
        }
        setState({ step: "downloading", update, current, done, total });
      });
      // Sous Windows, l'installeur ferme l'application ; ailleurs on relance.
      await relaunch();
    } catch (e) {
      setState({ step: "error", update, current, message: String(e) });
    }
  };

  const busy = state.step === "downloading" || state.step === "installing";
  const percent = state.step === "downloading" ? progressPercent(state.done, state.total) : null;

  return (
    <div
      role="dialog"
      aria-label="Mise à jour disponible"
      className="fixed right-4 bottom-4 z-50 w-96 rounded-lg border border-sky-700 bg-slate-900 p-4 shadow-2xl"
    >
      <p className="font-medium text-sky-300">Mise à jour disponible : v{update.version}</p>
      <p className="mt-0.5 text-slate-400 text-sm">Version installée : v{current}</p>

      {update.body && (
        <div className="mt-2">
          <button
            type="button"
            className="text-sky-400 text-sm hover:underline"
            onClick={() => setShowNotes((v) => !v)}
          >
            {showNotes ? "Masquer les nouveautés" : "Voir les nouveautés"}
          </button>
          {showNotes && (
            <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-slate-300 text-sm">
              {update.body}
            </p>
          )}
        </div>
      )}

      {state.step === "downloading" && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded bg-slate-800">
            <div
              className="h-full bg-sky-500 transition-all"
              style={{ width: percent === null ? "100%" : `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-slate-400 text-xs">
            Téléchargement… {formatBytes(state.done)}
            {state.total ? ` / ${formatBytes(state.total)}` : ""}
          </p>
        </div>
      )}
      {state.step === "installing" && (
        <p className="mt-3 text-slate-300 text-sm">Installation… l'application va redémarrer.</p>
      )}
      {state.step === "error" && (
        <p className="mt-3 text-red-400 text-sm">Échec de la mise à jour : {state.message}</p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded px-3 py-1.5 text-slate-300 text-sm hover:bg-slate-800 disabled:opacity-40"
          onClick={() => setState({ step: "idle" })}
        >
          Plus tard
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-sky-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-sky-500 disabled:opacity-40"
          onClick={install}
        >
          {state.step === "error" ? "Réessayer" : "Mettre à jour"}
        </button>
      </div>
    </div>
  );
}
