import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState } from "react";

export function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");

  const copy = async () => {
    try {
      await writeText(text);
      setState("done");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 1500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
    >
      {state === "done" ? "Copié ✓" : state === "error" ? "Échec de la copie" : label}
    </button>
  );
}
