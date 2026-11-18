import type { ReactNode } from "react";

const tones = {
  slate: "border-slate-600 bg-slate-800 text-slate-300",
  lad: "border-emerald-700 bg-emerald-950 text-emerald-300",
  scl: "border-sky-700 bg-sky-950 text-sky-300",
  stl: "border-violet-700 bg-violet-950 text-violet-300",
  tag: "border-amber-800 bg-amber-950/60 text-amber-300",
};

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: keyof typeof tones }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
