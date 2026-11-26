import { type ReactNode, useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Raccourci affiché à droite (ex. Ctrl+D). */
  hint?: string;
  danger?: boolean;
  /** Séparateur avant cet élément. */
  separated?: boolean;
}

/** Bouton « ⋯ » et son menu d'actions secondaires (fermé par Échap ou clic ailleurs). */
export function MoreMenu({ items, label = "Plus d'actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`rounded-md border px-3 py-1 text-sm ${open ? "border-sky-500 bg-sky-950 text-sky-100" : "border-slate-600 text-slate-200 hover:bg-slate-800"}`}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl shadow-slate-950"
        >
          {items.map((item) => (
            <MenuRow key={item.label} item={item} onDone={() => setOpen(false)} />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuRow({ item, onDone }: { item: MenuItem; onDone: () => void }): ReactNode {
  return (
    <>
      {item.separated && <div className="mx-2 my-1 h-px bg-slate-800" />}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onDone();
          item.onSelect();
        }}
        className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-slate-800 ${item.danger ? "text-red-300" : "text-slate-200"}`}
      >
        {item.label}
        {item.hint && <span className="font-mono text-xs text-slate-400">{item.hint}</span>}
      </button>
    </>
  );
}
