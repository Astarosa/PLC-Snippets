import { useMemo } from "react";
import type { LadProgram } from "../../core/ladder/ast";
import { CELL_W, layoutNetwork, type Shape } from "../../core/ladder/layout";

const WIRE = "#94a3b8"; // slate-400
const SYMBOL = "#34d399"; // emerald-400
const LABEL = "#e2e8f0"; // slate-200
const MAX_LABEL = 16;

const short = (label: string) => (label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label);

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

function ShapeView({ shape }: { shape: Shape }) {
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
