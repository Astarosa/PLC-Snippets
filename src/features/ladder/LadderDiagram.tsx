import { useMemo } from "react";
import type { LadProgram } from "../../core/ladder/ast";
import {
  BOX_PARAM_H,
  BOX_PARAM_Y,
  BOX_TOP,
  boxBottom,
  CELL_W,
  layoutNetwork,
  type Shape,
} from "../../core/ladder/layout";

const WIRE = "#94a3b8"; // slate-400
const SYMBOL = "#34d399"; // emerald-400
const LABEL = "#e2e8f0"; // slate-200
const PIN = "#7dd3fc"; // sky-300
const MONO = "Consolas, ui-monospace, monospace";
const MAX_LABEL = 16;

const short = (label: string, max = MAX_LABEL) =>
  label.length > max ? `${label.slice(0, max - 1)}…` : label;

/** Fils d'entrée et de sortie d'un élément d'une cellule, laissant `gap` px au centre. */
function Stubs({ x, y, gap }: { x: number; y: number; gap: number }) {
  const cx = x + CELL_W / 2;
  return (
    <>
      <line x1={x} y1={y} x2={cx - gap} y2={y} stroke={WIRE} strokeWidth={1.5} />
      <line x1={cx + gap} y1={y} x2={x + CELL_W} y2={y} stroke={WIRE} strokeWidth={1.5} />
    </>
  );
}

function Bars({ cx, y, gap }: { cx: number; y: number; gap: number }) {
  return (
    <>
      <line x1={cx - gap} y1={y - 12} x2={cx - gap} y2={y + 12} stroke={SYMBOL} strokeWidth={2} />
      <line x1={cx + gap} y1={y - 12} x2={cx + gap} y2={y + 12} stroke={SYMBOL} strokeWidth={2} />
    </>
  );
}

function Label({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fill={LABEL}
      fontSize={11}
      fontFamily="Consolas, ui-monospace, monospace"
    >
      <title>{text}</title>
      {short(text)}
    </text>
  );
}

export function ShapeView({ shape }: { shape: Shape }) {
  switch (shape.kind) {
    case "wire":
      return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke={WIRE} strokeWidth={1.5} />;
    case "rail":
      return <line x1={shape.x} y1={shape.y1} x2={shape.x} y2={shape.y2} stroke={WIRE} strokeWidth={3} />;
    case "title":
      return (
        <text x={shape.x} y={shape.y} fill="#7dd3fc" fontSize={12} fontWeight={600}>
          {shape.text}
        </text>
      );
    case "contact": {
      const cx = shape.x + CELL_W / 2;
      const { y } = shape;
      return (
        <g>
          <line x1={shape.x} y1={y} x2={cx - 10} y2={y} stroke={WIRE} strokeWidth={1.5} />
          <line x1={cx + 10} y1={y} x2={shape.x + CELL_W} y2={y} stroke={WIRE} strokeWidth={1.5} />
          <line x1={cx - 10} y1={y - 12} x2={cx - 10} y2={y + 12} stroke={SYMBOL} strokeWidth={2} />
          <line x1={cx + 10} y1={y - 12} x2={cx + 10} y2={y + 12} stroke={SYMBOL} strokeWidth={2} />
          {shape.variant === "NC" && (
            <line x1={cx - 7} y1={y + 10} x2={cx + 7} y2={y - 10} stroke={SYMBOL} strokeWidth={2} />
          )}
          <Label x={cx} y={y - 18} text={shape.label} />
        </g>
      );
    }
    case "edge": {
      const cx = shape.x + CELL_W / 2;
      const { y } = shape;
      return (
        <g>
          <Stubs x={shape.x} y={y} gap={10} />
          <Bars cx={cx} y={y} gap={10} />
          <text x={cx} y={y + 4} textAnchor="middle" fill={SYMBOL} fontSize={12} fontWeight={700}>
            {shape.variant}
          </text>
          <Label x={cx} y={y - 18} text={shape.label} />
          <Label x={cx} y={y + 28} text={shape.memory} />
        </g>
      );
    }
    case "compare": {
      const cx = shape.x + CELL_W / 2;
      const { y } = shape;
      return (
        <g>
          <Stubs x={shape.x} y={y} gap={16} />
          <Bars cx={cx} y={y} gap={16} />
          <text
            x={cx}
            y={y + 4}
            textAnchor="middle"
            fill={SYMBOL}
            fontSize={11}
            fontWeight={700}
            fontFamily={MONO}
          >
            {shape.op}
          </text>
          <Label x={cx} y={y - 18} text={shape.left} />
          <Label x={cx} y={y + 28} text={shape.right} />
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
          <line x1={x} y1={y} x2={left} y2={y} stroke={WIRE} strokeWidth={1.5} />
          <line x1={right} y1={y} x2={x + width} y2={y} stroke={WIRE} strokeWidth={1.5} />
          <rect
            x={left}
            y={top}
            width={right - left}
            height={bottom - top}
            rx={3}
            fill="#0f172a"
            stroke={SYMBOL}
            strokeWidth={1.5}
          />
          {shape.instance && <Label x={(left + right) / 2} y={top - 6} text={shape.instance} />}
          <text
            x={(left + right) / 2}
            y={y - 9}
            textAnchor="middle"
            fill={SYMBOL}
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
            return param.direction === "in" ? (
              <text key={param.name} x={left + 5} y={py} fontSize={10} fontFamily={MONO}>
                <title>{`${param.name} := ${param.value}`}</title>
                <tspan fill={PIN}>{param.name}</tspan>
                <tspan fill={LABEL}> {short(param.value, maxValue)}</tspan>
              </text>
            ) : (
              <text key={param.name} x={right - 5} y={py} textAnchor="end" fontSize={10} fontFamily={MONO}>
                <title>{`${param.name} => ${param.value}`}</title>
                <tspan fill={LABEL}>{short(param.value, maxValue)} </tspan>
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
          <line x1={shape.x} y1={y} x2={cx - 12} y2={y} stroke={WIRE} strokeWidth={1.5} />
          <path
            d={`M ${cx - 6} ${y - 12} Q ${cx - 16} ${y} ${cx - 6} ${y + 12} M ${cx + 6} ${y - 12} Q ${cx + 16} ${y} ${cx + 6} ${y + 12}`}
            fill="none"
            stroke={SYMBOL}
            strokeWidth={2}
          />
          {letter && (
            <text x={cx} y={y + 4} textAnchor="middle" fill={SYMBOL} fontSize={12} fontWeight={700}>
              {letter}
            </text>
          )}
          <Label x={cx} y={y - 18} text={shape.label} />
        </g>
      );
    }
  }
}

/** Dessine tous les réseaux d'un programme LADDER, l'un sous l'autre. */
export function LadderDiagram({ program }: { program: LadProgram }) {
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
          role="img"
          aria-label={`Réseau ${i + 1}`}
          className="block"
        >
          {d.shapes.map((shape, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: formes recalculées à chaque rendu
            <ShapeView key={j} shape={shape} />
          ))}
        </svg>
      ))}
    </div>
  );
}
