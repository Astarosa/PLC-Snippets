import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { useImport } from "../../state/import";

/** « Importer ▾ » : un fichier (zip, .scl, .awl) ou un dossier. Le glisser-déposer marche aussi. */
export function ImportButton({ disabled }: { disabled: boolean }) {
  const startImport = useImport((s) => s.open);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const pick = async (directory: boolean) => {
    setMenu(false);
    const path = await open(
      directory
        ? { directory: true, title: "Importer un dossier de snippets" }
        : {
            title: "Importer des snippets",
            filters: [
              { name: "Snippets et sources TIA", extensions: ["zip", "scl", "awl", "json"] },
              { name: "Tous les fichiers", extensions: ["*"] },
            ],
          },
    );
    if (typeof path === "string") startImport(path);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setMenu((m) => !m)}
        className="h-full rounded-md border border-slate-600 px-3 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
      >
        Importer ▾
      </button>
      {menu && (
        <div className="absolute top-full right-0 z-30 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
          <button
            type="button"
            onClick={() => pick(false)}
            className="block w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
          >
            Un fichier…
            <span className="block text-[11px] text-slate-500">zip PLC Snippets, source TIA .scl / .awl</span>
          </button>
          <button
            type="button"
            onClick={() => pick(true)}
            className="block w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
          >
            Un dossier…
            <span className="block text-[11px] text-slate-500">
              un snippet, plusieurs, ou une bibliothèque
            </span>
          </button>
          <p className="border-t border-slate-800 px-3 pt-1.5 pb-1 text-[11px] text-slate-500">
            Astuce : glisse un fichier ou un dossier sur la fenêtre.
          </p>
        </div>
      )}
    </div>
  );
}
