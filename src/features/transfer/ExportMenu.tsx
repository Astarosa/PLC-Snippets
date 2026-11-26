import { useEffect, useRef, useState } from "react";
import { ADAPTERS, FAMILIES } from "../../core/io/registry";
import type { Snippet } from "../../core/snippet/schema";
import { useSettings } from "../../state/settings";
import { runExport } from "../../storage/transfer";
import { MnemonicSwitch } from "../snippet/StlView";

export interface ExportStatus {
  kind: "ok" | "warning" | "error";
  text: string;
}

/**
 * Menu « Exporter ▾ » construit à partir des adaptateurs de formats.
 * `onPick` peut intercepter un format (ex. ouvrir le panneau TIA avec aperçu) : il renvoie true.
 */
export function ExportMenu({
  snippets,
  onPick,
  onStatus,
  align = "right",
  direction = "down",
  label = "Exporter",
}: {
  snippets: Snippet[];
  onPick?: (adapterId: string) => boolean;
  onStatus: (status: ExportStatus) => void;
  align?: "left" | "right";
  /** "up" pour un menu en bas de l'écran. */
  direction?: "up" | "down";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const stlMnemonic = useSettings((s) => s.stlMnemonic) ?? "DE";
  const setStlMnemonic = useSettings((s) => s.setStlMnemonic);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = async (adapterId: string) => {
    setOpen(false);
    if (onPick?.(adapterId)) return;
    try {
      const outcome = await runExport(adapterId, snippets, { stlMnemonic });
      if (!outcome.path && outcome.warnings.length === 0) return; // annulé
      if (!outcome.path) onStatus({ kind: "error", text: outcome.warnings.join(" · ") });
      else if (outcome.warnings.length > 0)
        onStatus({ kind: "warning", text: `Exporté : ${outcome.path} — ${outcome.warnings.join(" · ")}` });
      else onStatus({ kind: "ok", text: `Exporté : ${outcome.path}` });
    } catch (e) {
      onStatus({ kind: "error", text: String(e) });
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={snippets.length === 0}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-sky-800 px-3 py-1 text-sm text-sky-200 hover:bg-sky-950 disabled:opacity-40"
      >
        {label} ▾
      </button>
      {open && (
        <div
          className={`absolute z-30 w-80 ${direction === "up" ? "bottom-full mb-1" : "top-full mt-1"} overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {FAMILIES.map((family) => {
            const adapters = ADAPTERS.filter((a) => a.family === family && (a.export || a.planned));
            if (adapters.length === 0) return null;
            return (
              <div key={family}>
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {family}
                </p>
                {family === "TIA Portal" && (
                  <div className="flex items-center justify-between px-3 py-1.5 text-xs text-slate-400">
                    <span title="Doit correspondre à Options → Settings → General → Mnemonic dans TIA. Sert aux sources LIST et aux adresses des variables API (%I / %E).">
                      Mnémonique (LIST, adresses)
                    </span>
                    <MnemonicSwitch value={stlMnemonic} onChange={setStlMnemonic} />
                  </div>
                )}
                {adapters.map((a) => {
                  const refusals = snippets.map((s) => a.canExport?.(s) ?? null);
                  const none = snippets.length > 0 && refusals.every((r) => r !== null);
                  const disabled = a.planned || none;
                  const reason = a.planned ? "bientôt" : none ? (refusals[0] ?? "") : a.keeps;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => pick(a.id)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-transparent"
                    >
                      <span>{a.label}</span>
                      <span className={`text-[11px] ${a.lossless ? "text-emerald-400" : "text-slate-500"}`}>
                        {reason}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StatusLine({ status, onClose }: { status: ExportStatus | null; onClose: () => void }) {
  if (!status) return null;
  const color = { ok: "text-emerald-400", warning: "text-amber-300", error: "text-red-400" }[status.kind];
  return (
    <p className={`flex items-start gap-2 text-xs ${color}`}>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere] [word-break:normal]">{status.text}</span>
      <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
        ✕
      </button>
    </p>
  );
}
