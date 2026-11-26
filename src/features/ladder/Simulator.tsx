import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LadProgram } from "../../core/ladder/ast";
import {
  emptySimState,
  formatDuration,
  operandKey,
  type PowerFlow,
  parseLiteral,
  type SimVariable,
  scan,
  simVariables,
} from "../../core/ladder/simulate";
import { type DiagramSim, LadderDiagram } from "./LadderDiagram";

/** Période des cycles simulés (ms) : assez court pour voir les fronts et les tempos. */
const CYCLE_MS = 20;
const TIME_PINS = new Set(["PT", "ET"]);

/**
 * Simulation du LADDER : les entrées se forcent au pupitre ou d'un clic sur un contact,
 * le programme tourne en cycles comme sur la CPU, le courant s'affiche sur le schéma.
 * Ce n'est pas PLCSIM : pas de types stricts, ni de temps de cycle réel, ni de périphérie.
 */
export function Simulator({ program }: { program: LadProgram }) {
  const state = useRef(emptySimState());
  const clock = useRef({ base: 0, startedAt: 0 });
  const [running, setRunning] = useState(true);
  const [flow, setFlow] = useState<PowerFlow>(() => scan(program, state.current, 0));
  const [, setVersion] = useState(0);
  const variables = useMemo(() => simVariables(program), [program]);
  const inputs = variables.filter((v) => !v.written);
  const watched = variables.filter((v) => v.written);
  const forceable = useMemo(
    () => new Set(inputs.filter((v) => v.kind === "bool").map((v) => v.key)),
    [inputs],
  );

  const now = useCallback(
    () => (running ? clock.current.base + performance.now() - clock.current.startedAt : clock.current.base),
    [running],
  );
  const step = useCallback(() => setFlow(scan(program, state.current, now())), [program, now]);

  useEffect(() => {
    if (!running) return;
    clock.current.startedAt = performance.now();
    const id = window.setInterval(step, CYCLE_MS);
    return () => {
      clock.current.base += performance.now() - clock.current.startedAt;
      window.clearInterval(id);
    };
  }, [running, step]);

  const setValue = (key: string, value: boolean | number) => {
    state.current.values.set(key, value);
    setVersion((v) => v + 1);
    if (!running) step();
  };
  const toggle = (label: string) => {
    const key = operandKey(label);
    if (forceable.has(key)) setValue(key, !state.current.values.get(key));
  };
  const reset = () => {
    state.current = emptySimState();
    clock.current = { base: 0, startedAt: performance.now() };
    setFlow(scan(program, state.current, 0));
  };

  const display = (label: string, pin?: string): string | undefined => {
    if (parseLiteral(label) !== null) return undefined;
    const key = operandKey(label);
    const v = state.current.values.get(key);
    const kind = variables.find((x) => x.key === key)?.kind;
    if (typeof v === "boolean" || (v === undefined && kind !== "number" && !TIME_PINS.has(pin ?? "")))
      return undefined;
    const n = typeof v === "number" ? v : 0;
    return pin && TIME_PINS.has(pin) ? formatDuration(n) : String(Math.round(n * 1000) / 1000);
  };

  const sim: DiagramSim = { flow, value: display, toggle };

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          className="rounded border border-slate-700 px-2.5 py-1 text-slate-200 hover:bg-slate-800"
        >
          {running ? "⏸ Pause" : "▶ Reprendre"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-slate-700 px-2.5 py-1 text-slate-200 hover:bg-slate-800"
        >
          ↺ Réinitialiser
        </button>
        <span className="text-slate-400">
          {running ? "En marche" : "En pause"} · temps {formatDuration(state.current.now)}
        </span>
        <span className="ml-auto text-slate-500">
          Clic sur un contact = inverser l'entrée. Simulation indicative, à valider sous PLCSIM.
        </span>
      </div>

      <div className="grid gap-3 2xl:grid-cols-[1fr_280px]">
        <div className="min-w-0 rounded-md border border-slate-800 p-2">
          <LadderDiagram program={program} sim={sim} />
        </div>
        <aside className="grid content-start gap-3 text-xs sm:grid-cols-2 2xl:grid-cols-1">
          <Panel title="Entrées (à forcer)">
            {inputs.length === 0 && <p className="text-slate-500">Aucune.</p>}
            {inputs.map((v) => (
              <InputRow
                key={v.key}
                variable={v}
                value={state.current.values.get(v.key)}
                onChange={(x) => setValue(v.key, x)}
              />
            ))}
          </Panel>
          <Panel title="Sorties et mémoires">
            {watched.length === 0 && <p className="text-slate-500">Aucune.</p>}
            {watched.map((v) => (
              <div key={v.key} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-slate-300" title={v.label}>
                  {v.label}
                </span>
                <ValueBadge variable={v} value={state.current.values.get(v.key)} />
              </div>
            ))}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-md border border-slate-800 p-2.5">
      <p className="font-semibold text-sky-300">{title}</p>
      {children}
    </div>
  );
}

function ValueBadge({ variable, value }: { variable: SimVariable; value: boolean | number | undefined }) {
  if (variable.kind === "bool" || typeof value === "boolean") {
    const on = Boolean(value);
    return (
      <span
        className={`rounded px-1.5 font-mono ${on ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400"}`}
      >
        {on ? "1" : "0"}
      </span>
    );
  }
  const n = value ?? 0;
  return (
    <span className="font-mono text-amber-300">{variable.key.endsWith(".ET") ? formatDuration(n) : n}</span>
  );
}

function InputRow({
  variable,
  value,
  onChange,
}: {
  variable: SimVariable;
  value: boolean | number | undefined;
  onChange: (value: boolean | number) => void;
}) {
  if (variable.kind === "bool") {
    const on = Boolean(value);
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(!on)}
        className={`flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left ${
          on ? "bg-emerald-950/60" : "hover:bg-slate-800"
        }`}
      >
        <span className="truncate font-mono text-slate-200" title={variable.label}>
          {variable.label}
        </span>
        <span
          className={`rounded px-1.5 font-mono ${on ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400"}`}
        >
          {on ? "1" : "0"}
        </span>
      </button>
    );
  }
  return (
    <label className="flex items-center justify-between gap-2 px-1.5">
      <span className="truncate font-mono text-slate-200" title={variable.label}>
        {variable.label}
      </span>
      <input
        type="number"
        value={typeof value === "number" ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-right font-mono text-slate-100"
      />
    </label>
  );
}
