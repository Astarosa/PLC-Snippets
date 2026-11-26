import type { KeyboardEvent, SVGProps } from "react";
import { useMemo } from "react";
import type { LadProgram } from "../../core/ladder/ast";
import {
  BOX_PARAM_H,
  BOX_PARAM_Y,
  BOX_TOP,
  boxBottom,
  CELL_W,
  layoutNetwork,
  powerKey,
  type Shape,
} from "../../core/ladder/layout";
import type { PowerFlow } from "../../core/ladder/simulate";

// Couleurs du thème (variables Tailwind) : le schéma suit le mode clair / sombre.
const WIRE = "var(--color-slate-400)";
const SYMBOL = "var(--color-emerald-400)";
const LABEL = "var(--color-slate-200)";
const PIN = "var(--color-sky-300)";
const BOX_FILL = "var(--color-slate-900)";
const MONO = "Consolas, ui-monospace, monospace";
// Simulation : courant (vert, épais) / pas de courant (gris, pointillés), comme TIA en visualisation.
const LIVE = "var(--color-emerald-400)";
const DEAD = "var(--color-slate-500)";
const VALUE = "var(--color-amber-300)";

/** État de simulation d'une forme : courant à l'entrée / la sortie, valeurs, forçage. */
export interface ShapeSim {
  power?: { in: boolean; out: boolean };
  value: (label: string, pin?: string) => string | undefined;
  /** Inverse une entrée booléenne (clic sur un contact), si elle est forçable. */
  toggle?: (label: string) => void;
}

/** Style d'un fil : normal, ou sous tension / hors tension en simulation. */
function wireStyle(
  sim: ShapeSim | undefined,
  on: boolean | undefined,
  width = 1.5,
): SVGProps<SVGLineElement> {
  if (!sim) return { stroke: WIRE, strokeWidth: width };
  return on
    ? { stroke: LIVE, strokeWidth: width + 1 }
    : { stroke: DEAD, strokeWidth: width, strokeDasharray: "4 3" };
}
const symbolColor = (sim: ShapeSim | undefined) => (!sim ? SYMBOL : sim.power?.out ? LIVE : DEAD);

const MAX_LABEL = 16;

const short = (label: string, max = MAX_LABEL) =>
  label.length > max ? `${label.slice(0, max - 1)}…` : label;

/** Fils d'entrée et de sortie d'un élément d'une cellule, laissant `gap` px au centre. */
function Stubs({ x, y, gap, sim }: { x: number; y: number; gap: number; sim?: ShapeSim }) {
  const cx = x + CELL_W / 2;
  return (
    <>
      <line x1={x} y1={y} x2={cx - gap} y2={y} {...wireStyle(sim, sim?.power?.in)} />
      <line x1={cx + gap} y1={y} x2={x + CELL_W} y2={y} {...wireStyle(sim, sim?.power?.out)} />
    </>
  );
}

function Bars({ cx, y, gap, color = SYMBOL }: { cx: number; y: number; gap: number; color?: string }) {
  return (
    <>
      <line x1={cx - gap} y1={y - 12} x2={cx - gap} y2={y + 12} stroke={color} strokeWidth={2} />
      <line x1={cx + gap} y1={y - 12} x2={cx + gap} y2={y + 12} stroke={color} strokeWidth={2} />
    </>
  );
}

function Label({ x, y, text, value }: { x: number; y: number; text: string; value?: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fill={LABEL} fontSize={11} fontFamily={MONO}>
      <title>{value === undefined ? text : `${text} = ${value}`}</title>
      {short(text, value === undefined ? MAX_LABEL : 11)}
      {value !== undefined && <tspan fill={VALUE}> {value}</tspan>}
    </text>
  );
}

/** Contact cliquable en simulation : inverse l'entrée. */
function toggleProps(sim: ShapeSim | undefined, label: string) {
  if (!sim?.toggle) return {};
  const toggle = sim.toggle;
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": `Inverser ${label}`,
    style: { cursor: "pointer" },
    onClick: () => toggle(label),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle(label);
      }
    },
  };
}

export function ShapeView({ shape, sim }: { shape: Shape; sim?: ShapeSim }) {
  const sym = symbolColor(sim);
  switch (shape.kind) {
    case "wire":
      return (
        <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...wireStyle(sim, sim?.power?.out)} />
      );
    case "rail":
      return (
        <line
          x1={shape.x}
          y1={shape.y1}
          x2={shape.x}
          y2={shape.y2}
          {...wireStyle(sim, true, 3)}
          strokeDasharray={undefined}
        />
      );
    case "title":
      return (
        <text x={shape.x} y={shape.y} fill={PIN} fontSize={12} fontWeight={600}>
          {shape.text}
        </text>
      );
    case "note":
      return (
        <text x={shape.x} y={shape.y} fill={WIRE} fontSize={11} fontStyle="italic">
          {`// ${shape.text}`}
        </text>
      );
    case "contact": {
      const cx = shape.x + CELL_W / 2;
      const { y } = shape;
      return (
        <g {...toggleProps(sim, shape.label)}>
          {sim?.toggle && (
            <rect x={shape.x + 4} y={y - 32} width={CELL_W - 8} height={48} fill="transparent" />
          )}
          <Stubs x={shape.x} y={y} gap={10} sim={sim} />
          <Bars cx={cx} y={y} gap={10} color={sym} />
          {shape.variant === "NC" && (
            <line x1={cx - 7} y1={y + 10} x2={cx + 7} y2={y - 10} stroke={sym} strokeWidth={2} />
          )}
          <Label x={cx} y={y - 18} text={shape.label} value={sim?.value(shape.label)} />
        </g>
      );
    }
    case "edge": {
      const cx = shape.x + CELL_W / 2;
      const { y } = shape;
      return (
        <g {...toggleProps(sim, shape.label)}>
          {sim?.toggle && (
            <rect x={shape.x + 4} y={y - 32} width={CELL_W - 8} height={48} fill="transparent" />
          )}
          <Stubs x={shape.x} y={y} gap={10} sim={sim} />
          <Bars cx={cx} y={y} gap={10} color={sym} />
          <text x={cx} y={y + 4} textAnchor="middle" fill={sym} fontSize={12} fontWeight={700}>
            {shape.variant}
          </text>
          <Label x={cx} y={y - 18} text={shape.label} value={sim?.value(shape.label)} />
          <Label x={cx} y={y + 28} text={shape.memory} value={sim?.value(shape.memory)} />
        </g>
      );
    }
    case "compare": {
      const cx = shape.x + CELL_W / 2;
      const { y } = shape;
      return (
        <g>
          <Stubs x={shape.x} y={y} gap={16} sim={sim} />
          <Bars cx={cx} y={y} gap={16} color={sym} />
          <text
            x={cx}
            y={y + 4}
            textAnchor="middle"
            fill={sym}
            fontSize={11}
            fontWeight={700}
            fontFamily={MONO}
          >
            {shape.op}
          </text>
          <Label x={cx} y={y - 18} text={shape.left} value={sim?.value(shape.left)} />
          <Label x={cx} y={y + 28} text={shape.right} value={sim?.value(shape.right)} />
        </g>
      );
    }
    case "box": {
      const { x, y, width } = shape;
      const left = x + 18;
      const right = x + width - 18;
      const top = y - BOX_TOP;
      const bottom = y + boxBottom(shape.params.length);
      const maxValue = 22;
      return (
        <g>
          <line x1={x} y1={y} x2={left} y2={y} {...wireStyle(sim, sim?.power?.in)} />
          <line x1={right} y1={y} x2={x + width} y2={y} {...wireStyle(sim, sim?.power?.out)} />
          <rect
            x={left}
            y={top}
            width={right - left}
            height={bottom - top}
            rx={3}
            fill={BOX_FILL}
            stroke={sym}
            strokeWidth={1.5}
          />
          {shape.instance && <Label x={(left + right) / 2} y={top - 6} text={shape.instance} />}
          <text
            x={(left + right) / 2}
            y={y - 9}
            textAnchor="middle"
            fill={sym}
            fontSize={12}
            fontWeight={700}
          >
            {shape.title}
          </text>
          <text x={left + 5} y={y + 4} fill={PIN} fontSize={10} fontFamily={MONO}>
            {shape.mainIn}
          </text>
          <text x={right - 5} y={y + 4} textAnchor="end" fill={PIN} fontSize={10} fontFamily={MONO}>
            {shape.mainOut}
          </text>
          {shape.params.map((param, i) => {
            const py = y + BOX_PARAM_Y + i * BOX_PARAM_H;
            const live = sim?.value(param.value, param.name);
            const max = live === undefined ? maxValue : 12;
            return param.direction === "in" ? (
              <text key={param.name} x={left + 5} y={py} fontSize={10} fontFamily={MONO}>
                <title>{`${param.name} := ${param.value}${live === undefined ? "" : ` = ${live}`}`}</title>
                <tspan fill={PIN}>{param.name}</tspan>
                <tspan fill={LABEL}> {short(param.value, max)}</tspan>
                {live !== undefined && <tspan fill={VALUE}> {live}</tspan>}
              </text>
            ) : (
              <text key={param.name} x={right - 5} y={py} textAnchor="end" fontSize={10} fontFamily={MONO}>
                <title>{`${param.name} => ${param.value}${live === undefined ? "" : ` = ${live}`}`}</title>
                {live !== undefined && <tspan fill={VALUE}>{live} </tspan>}
                <tspan fill={LABEL}>{short(param.value, max)} </tspan>
                <tspan fill={PIN}>{param.name}</tspan>
              </text>
            );
          })}
        </g>
      );
    }
    case "coil": {
      const cx = shape.x + CELL_W / 2;
      const { y } = shape;
      const letter = { COIL: "", NCOIL: "/", SET: "S", RESET: "R" }[shape.variant];
      return (
        <g>
          <line x1={shape.x} y1={y} x2={cx - 12} y2={y} {...wireStyle(sim, sim?.power?.in)} />
          <path
            d={`M ${cx - 6} ${y - 12} Q ${cx - 16} ${y} ${cx - 6} ${y + 12} M ${cx + 6} ${y - 12} Q ${cx + 16} ${y} ${cx + 6} ${y + 12}`}
            fill="none"
            stroke={sym}
            strokeWidth={2}
          />
          {letter && (
            <text x={cx} y={y + 4} textAnchor="middle" fill={sym} fontSize={12} fontWeight={700}>
              {letter}
            </text>
          )}
          <Label x={cx} y={y - 18} text={shape.label} value={sim?.value(shape.label)} />
        </g>
      );
    }
  }
}

/** Simulation affichée sur le schéma : courant par réseau, valeurs, forçage des entrées. */
export interface DiagramSim {
  flow: PowerFlow;
  value: (label: string, pin?: string) => string | undefined;
  toggle?: (label: string) => void;
}

/** Courant porté par une forme dans le flux d'un réseau. */
function shapePower(
  shape: Shape,
  flow: PowerFlow[number] | undefined,
): { in: boolean; out: boolean } | undefined {
  if (!flow) return undefined;
  if (shape.kind === "wire") {
    if (!shape.power) return { in: true, out: true };
    const f = flow.get(shape.power.key);
    const on = f ? f[shape.power.side] : false;
    return { in: on, out: on };
  }
  if (!("ref" in shape) || !shape.ref) return undefined;
  const { rung, path, output } = shape.ref;
  return flow.get(output !== undefined ? `${rung}:o${output}` : powerKey(rung, path ?? []));
}

/** Dessine tous les réseaux d'un programme LADDER, l'un sous l'autre. */
export function LadderDiagram({ program, sim }: { program: LadProgram; sim?: DiagramSim }) {
  const diagrams = useMemo(() => program.networks.map(layoutNetwork), [program]);
  return (
    <div className="space-y-3 overflow-x-auto">
      {diagrams.map((d, i) => (
        <svg
          // biome-ignore lint/suspicious/noArrayIndexKey: les réseaux n'ont pas d'identifiant propre
          key={i}
          width={d.width}
          height={d.height}
          viewBox={`0 0 ${d.width} ${d.height}`}
          // En simulation, les contacts sont des boutons : le schéma n'est plus une simple image.
          role={sim ? "group" : "img"}
          aria-label={`Réseau ${i + 1}`}
          className="block"
        >
          {d.shapes.map((shape, j) => (
            <ShapeView
              // biome-ignore lint/suspicious/noArrayIndexKey: formes recalculées à chaque rendu
              key={j}
              shape={shape}
              sim={
                sim && {
                  power: shapePower(shape, sim.flow[i]),
                  value: sim.value,
                  toggle: shape.kind === "contact" || shape.kind === "edge" ? sim.toggle : undefined,
                }
              }
            />
          ))}
        </svg>
      ))}
    </div>
  );
}
