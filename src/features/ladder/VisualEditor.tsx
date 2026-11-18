import { ask } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Expr, LadProgram, Output } from "../../core/ladder/ast";
import {
  addOutput,
  addRung,
  appendRung,
  canRemoveOutput,
  type ElementRef,
  findRef,
  getExpr,
  inRange,
  insertParallel,
  insertSeries,
  moveExpr,
  moveOutput,
  newElement,
  newOutput,
  normalizeProgram,
  type PaletteItem,
  type RangeRef,
  rangeBetween,
  removeExpr,
  removeNetwork,
  removeOutput,
  removeRange,
  setNetworkComment,
  setNetworkTitle,
  wrapParallel,
} from "../../core/ladder/edit";
import {
  BOX_CELLS,
  boxBottom,
  CELL_W,
  layoutNetwork,
  type Shape,
  type ShapeRef,
} from "../../core/ladder/layout";
import { formatLadError, parseLadder } from "../../core/ladder/parse";
import { printLadder } from "../../core/ladder/print";
import { Inspector, RangeInspector } from "./Inspector";
import { ShapeView } from "./LadderDiagram";
import { PALETTE } from "./palette";

/* ---------- Ce qu'on fait glisser, et où on peut le poser ---------- */

type Payload =
  | { src: "palette"; item: PaletteItem; label: string }
  | { src: "move"; ref: ElementRef; label: string };

type Zone =
  | { t: "series"; n: number; r: number; path: number[]; side: "before" | "after" }
  | { t: "parallel"; n: number; r: number; path: number[] }
  | { t: "wrap"; range: RangeRef }
  | { t: "coil"; n: number; r: number }
  | { t: "rung"; n: number }
  | { t: "trash" };

const zoneAttr = (z: Zone) => JSON.stringify(z);
const sameZone = (a: Zone | null, b: Zone) => a !== null && zoneAttr(a) === zoneAttr(b);
const isCoilPayload = (p: Payload) =>
  p.src === "palette" ? p.item.kind === "coil" : p.ref.kind === "output";

/** Formes qui représentent un élément éditable (contacts, boîtes, bobines…). */
type ElementShape = Extract<Shape, { ref?: ShapeRef }> & { ref: ShapeRef };

const shapeWidth = (shape: ElementShape) => (shape.kind === "box" ? BOX_CELLS * CELL_W : CELL_W);
const shapeBox = (shape: ElementShape) => ({
  x: shape.x + 4,
  y: shape.y - 34,
  w: shapeWidth(shape) - 8,
  h: shape.kind === "box" ? 34 + boxBottom(shape.params.length) + 4 : 68,
});

const refOf = (n: number, ref: ShapeRef): ElementRef =>
  ref.output !== undefined
    ? { kind: "output", network: n, rung: ref.rung, output: ref.output }
    : { kind: "expr", network: n, rung: ref.rung, path: ref.path ?? [] };

const sameRef = (a: ElementRef | null, b: ElementRef) =>
  a !== null && JSON.stringify(a) === JSON.stringify(b);

interface DropResult {
  program: LadProgram;
  select: Expr | Output | null;
}

/** Applique un dépôt (symbole de la palette ou élément déplacé). null = dépôt impossible ici. */
function applyDrop(program: LadProgram, zone: Zone, payload: Payload): DropResult | null {
  if (zone.t === "trash") {
    if (payload.src !== "move") return null;
    const ref = payload.ref;
    if (ref.kind === "expr") return { program: removeExpr(program, ref), select: null };
    return canRemoveOutput(program, ref) ? { program: removeOutput(program, ref), select: null } : null;
  }

  // Bobines : uniquement dans la colonne des bobines (ou un nouveau rung pour la palette).
  if (isCoilPayload(payload)) {
    if (payload.src === "palette" && payload.item.kind === "coil") {
      if (zone.t === "coil") {
        const output = newOutput(payload.item.variant);
        return { program: addOutput(program, zone.n, zone.r, output), select: output };
      }
      if (zone.t === "rung") {
        const next = normalizeProgram(addRung(program, zone.n, payload.item));
        const network = next.networks[Math.min(zone.n, next.networks.length - 1)];
        return { program: next, select: network.rungs[network.rungs.length - 1].outputs[0] };
      }
      return null;
    }
    if (payload.src === "move" && payload.ref.kind === "output" && zone.t === "coil") {
      const { network, rung, output } = payload.ref;
      const original = program.networks[network]?.rungs[rung]?.outputs[output];
      if (!original) return null;
      const { program: next, moved } = moveOutput(program, original, zone.n, zone.r);
      return { program: next, select: moved };
    }
    return null;
  }

  if (zone.t === "coil") return null;

  // Contacts et boîtes : pose d'un élément (nouveau ou copie de l'élément déplacé).
  const place = (p: LadProgram, element: Expr): LadProgram => {
    switch (zone.t) {
      case "series":
        return insertSeries(p, { network: zone.n, rung: zone.r, path: zone.path }, zone.side, element);
      case "parallel":
        return insertParallel(p, { network: zone.n, rung: zone.r, path: zone.path }, element);
      case "wrap":
        return wrapParallel(p, zone.range, element);
      case "rung": {
        const box = element.type === "box";
        return appendRung(p, zone.n, { condition: element, outputs: box ? [] : [newOutput("COIL")] });
      }
    }
  };

  if (payload.src === "palette") {
    if (payload.item.kind === "coil") return null;
    const element = newElement(payload.item);
    return { program: place(program, element), select: element };
  }
  if (payload.ref.kind !== "expr") return null;
  const original = getExpr(program, payload.ref);
  if (!original) return null;
  const { program: next, moved } = moveExpr(program, original, place);
  return { program: next, select: moved };
}

/**
 * Éditeur LADDER visuel. Le texte DSL reste la référence : chaque modification le réécrit,
 * et l'onglet Texte reste disponible.
 *
 * - glisser un symbole de la palette, ou un élément déjà posé, vers une zone bleue ;
 * - cliquer un symbole puis une zone (sans glisser) ;
 * - clic = sélection, Maj + clic = plage d'éléments, Suppr = effacer, corbeille = effacer en glissant.
 */
export function VisualEditor({ source, onChange }: { source: string; onChange: (source: string) => void }) {
  const parsed = useMemo(() => (source.trim() ? parseLadder(source) : null), [source]);
  const program = useMemo<LadProgram | null>(() => {
    if (parsed === null) return { networks: [] };
    return parsed.ok ? normalizeProgram(parsed.program) : null;
  }, [parsed]);

  const [selected, setSelected] = useState<ElementRef | null>(null);
  const [range, setRange] = useState<RangeRef | null>(null);
  const [armed, setArmed] = useState<Payload | null>(null);
  const [drag, setDrag] = useState<{
    payload: Payload;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const [hover, setHover] = useState<Zone | null>(null);
  /** Après un glisser, le clic qui suit le relâchement ne doit pas changer la sélection. */
  const justDragged = useRef(false);

  const tool = drag?.active ? drag.payload : armed;

  const select = (ref: ElementRef | null) => {
    setSelected(ref);
    setRange(null);
  };

  const commit = useCallback(
    (next: LadProgram, focus?: Expr | Output | null) => {
      onChange(printLadder(next));
      setSelected(focus ? findRef(next, focus) : null);
      setRange(null);
    },
    [onChange],
  );

  const drop = useCallback(
    (zone: Zone, payload: Payload) => {
      if (!program) return;
      const result = applyDrop(program, zone, payload);
      if (result) commit(result.program, result.select);
    },
    [program, commit],
  );

  // Glisser à la souris (pointer events : fiable dans toutes les webviews).
  useEffect(() => {
    if (!drag) return;
    const zoneAt = (x: number, y: number): Zone | null => {
      const el = document.elementFromPoint(x, y)?.closest("[data-zone]");
      return el ? (JSON.parse(el.getAttribute("data-zone") as string) as Zone) : null;
    };
    const move = (e: PointerEvent) => {
      const active = drag.active || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5;
      setDrag({ ...drag, x: e.clientX, y: e.clientY, active });
      setHover(active ? zoneAt(e.clientX, e.clientY) : null);
    };
    const up = (e: PointerEvent) => {
      if (drag.active) {
        justDragged.current = true;
        setTimeout(() => {
          justDragged.current = false;
        }, 0);
        const zone = zoneAt(e.clientX, e.clientY);
        if (zone) drop(zone, drag.payload);
        setArmed(null);
      } else if (drag.payload.src === "palette") {
        // Simple clic sur la palette : le symbole est « armé », on clique ensuite sur une zone.
        const label = drag.payload.label;
        setArmed((a) => (a?.label === label ? null : drag.payload));
      }
      setDrag(null);
      setHover(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, drop]);

  // Clavier : Échap annule, Suppr efface la sélection (élément ou plage).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, .cm-editor");
      if (e.key === "Escape") {
        setArmed(null);
        setSelected(null);
        setRange(null);
      }
      if (typing || !program || !(e.key === "Delete" || e.key === "Backspace")) return;
      if (range) {
        e.preventDefault();
        commit(removeRange(program, range));
      } else if (selected) {
        e.preventDefault();
        if (selected.kind === "expr") commit(removeExpr(program, selected));
        else if (canRemoveOutput(program, selected)) commit(removeOutput(program, selected));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [program, selected, range, commit]);

  if (!program) {
    return (
      <p className="rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
        Le texte LADDER contient une erreur ({parsed && !parsed.ok ? formatLadError(parsed.error) : ""}).
        Corrige-la dans l'onglet Texte pour revenir à l'éditeur visuel.
      </p>
    );
  }

  const zoneProps = (z: Zone) => ({
    "data-zone": zoneAttr(z),
    onClick: () => {
      if (armed) {
        drop(z, armed);
        setArmed(null);
      }
    },
  });
  const zoneClass = (z: Zone) =>
    `cursor-copy ${sameZone(hover, z) ? "fill-sky-400/50 stroke-sky-300" : "fill-sky-500/15 stroke-sky-500/60"}`;

  const draggedRef = drag?.active && drag.payload.src === "move" ? drag.payload.ref : null;
  const coilTool = tool ? isCoilPayload(tool) : false;

  const deleteNetwork = async (n: number) => {
    const ok = await ask(`Supprimer le réseau ${n + 1} et tout son contenu ?`, {
      title: "Supprimer le réseau",
      kind: "warning",
      okLabel: "Supprimer",
      cancelLabel: "Annuler",
    });
    if (ok) commit(removeNetwork(program, n));
  };

  return (
    <div className="grid grid-cols-[150px_1fr] gap-3">
      {/* Palette */}
      <aside className="select-none space-y-3 rounded-lg border border-slate-700 bg-slate-900/60 p-2">
        {PALETTE.map((group) => (
          <div key={group.title}>
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {group.title}
            </p>
            <div className="grid grid-cols-2 gap-1">
              {group.entries.map((entry) => {
                const isArmed = armed?.label === entry.label;
                return (
                  <button
                    key={entry.label}
                    type="button"
                    title={`${entry.hint} — glisse-le dans le réseau, ou clique puis clique sur une zone`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setDrag({
                        payload: { src: "palette", item: entry.item, label: entry.label },
                        startX: e.clientX,
                        startY: e.clientY,
                        x: e.clientX,
                        y: e.clientY,
                        active: false,
                      });
                    }}
                    className={`cursor-grab rounded border px-1 py-1 text-center active:cursor-grabbing ${
                      isArmed
                        ? "border-sky-500 bg-sky-950"
                        : "border-slate-700 bg-slate-950 hover:border-slate-500"
                    }`}
                  >
                    <div className="font-mono text-[11px] text-emerald-400">{entry.glyph}</div>
                    <div className="text-[10px] text-slate-300">{entry.label}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </aside>

      <div className="min-w-0 space-y-3">
        {/* Bandeau : aide, consigne de dépôt, ou propriétés de la sélection */}
        <aside className="sticky top-0 z-10 min-h-[100px] rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-lg shadow-slate-950">
          {tool ? (
            <div className="flex items-start gap-3">
              <p className="flex-1 text-xs text-sky-200">
                {coilTool
                  ? "Dépose la bobine dans la colonne des bobines d'un rung"
                  : "Dépose avant / après un élément (série), en dessous (parallèle)"}
                {range && !coilTool ? ", sous la sélection (branche autour)" : ""}
                {tool.src === "palette" ? ", ou sur « nouveau rung »." : "."} Échap pour annuler.
              </p>
              {tool.src === "move" && (
                <div
                  {...zoneProps({ t: "trash" })}
                  className={`rounded border border-dashed px-4 py-3 text-xs ${
                    sameZone(hover, { t: "trash" })
                      ? "border-red-400 bg-red-900/60 text-red-100"
                      : "border-red-800 bg-red-950/40 text-red-300"
                  }`}
                >
                  🗑 Corbeille
                </div>
              )}
            </div>
          ) : range ? (
            <RangeInspector
              program={program}
              range={range}
              onChange={(next, focus) => commit(next, focus)}
              onClear={() => select(null)}
            />
          ) : selected ? (
            <Inspector
              key={JSON.stringify(selected)}
              program={program}
              selected={selected}
              // Modifier un élément ne change pas son adresse : il reste sélectionné.
              onChange={(next) => onChange(printLadder(next))}
              onReplaceSelection={(next, focus) => commit(next, focus)}
              onDeleted={() => select(null)}
            />
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
              <p>Glisse un symbole de la palette, ou un élément déjà posé, vers une zone bleue.</p>
              <p>
                Clic : sélectionner · Maj + clic : sélectionner une plage (pour une branche parallèle autour).
              </p>
              <p>Suppr ou glisser vers la corbeille : effacer.</p>
            </div>
          )}
        </aside>

        {program.networks.map((network, n) => {
          const d = layoutNetwork(network);
          const elements = d.shapes.filter((s): s is ElementShape => "ref" in s && s.ref !== undefined);
          const rangeShapes = range
            ? elements.filter((s) => s.ref.path && inRange(range, n, s.ref.rung, s.ref.path))
            : [];
          const rangeBox =
            rangeShapes.length > 0
              ? rangeShapes.map(shapeBox).reduce((a, b) => ({
                  x: Math.min(a.x, b.x),
                  y: Math.min(a.y, b.y),
                  w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
                  h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
                }))
              : null;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: les réseaux n'ont pas d'identifiant propre
            <section key={n} className="rounded-lg border border-slate-700 bg-slate-900/60 p-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-500">Réseau {n + 1}</span>
                <input
                  key={`title-${network.title ?? ""}`}
                  defaultValue={network.title ?? ""}
                  placeholder="Titre du réseau"
                  onBlur={(e) => {
                    if (e.target.value !== (network.title ?? ""))
                      commit(setNetworkTitle(program, n, e.target.value));
                  }}
                  onKeyDown={(e) => {
                    // Entrée valide le titre sans soumettre le formulaire du snippet.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                  className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-sky-300 hover:border-slate-700 focus:border-sky-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => deleteNetwork(n)}
                  className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-red-950 hover:text-red-300"
                >
                  Supprimer le réseau
                </button>
              </div>
              <textarea
                key={`comment-${network.comment ?? ""}`}
                defaultValue={network.comment ?? ""}
                placeholder="Commentaire du réseau"
                rows={Math.max(1, (network.comment ?? "").split("\n").length)}
                onBlur={(e) => {
                  if (e.target.value !== (network.comment ?? ""))
                    commit(setNetworkComment(program, n, e.target.value));
                }}
                className="mb-1 w-full resize-y rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-400 italic placeholder:text-slate-600 hover:border-slate-700 focus:border-sky-600 focus:outline-none"
              />
              <div className="overflow-x-auto">
                <svg
                  width={d.width}
                  height={d.height}
                  viewBox={`0 0 ${d.width} ${d.height}`}
                  className="block"
                  role="img"
                  aria-label={`Réseau ${n + 1}`}
                >
                  {d.shapes
                    .filter((s) => s.kind !== "title" && !(s.kind === "note" && s.scope === "network"))
                    .map((shape, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: formes recalculées à chaque rendu
                      <ShapeView key={i} shape={shape} />
                    ))}

                  {rangeBox && (
                    <rect
                      x={rangeBox.x - 2}
                      y={rangeBox.y - 2}
                      width={rangeBox.w + 4}
                      height={rangeBox.h + 4}
                      rx={5}
                      className="pointer-events-none fill-sky-400/10 stroke-sky-400"
                    />
                  )}

                  {/* Éléments : clic = sélection, glisser = déplacer */}
                  {!tool &&
                    elements.map((shape) => {
                      const ref = refOf(n, shape.ref);
                      const isSel = !range && sameRef(selected, ref);
                      const b = shapeBox(shape);
                      return (
                        // biome-ignore lint/a11y/noStaticElementInteractions: élément graphique manipulable à la souris
                        <rect
                          key={JSON.stringify(ref)}
                          x={b.x}
                          y={b.y}
                          width={b.w}
                          height={b.h}
                          rx={4}
                          className={`cursor-grab ${isSel ? "fill-sky-400/10 stroke-sky-400" : "fill-transparent stroke-transparent hover:stroke-slate-500"}`}
                          strokeDasharray={isSel ? undefined : "3 3"}
                          onPointerDown={(e) => {
                            if (e.shiftKey) return;
                            e.preventDefault();
                            const label =
                              shape.kind === "box" ? shape.title : "label" in shape ? shape.label : "";
                            setDrag({
                              payload: { src: "move", ref, label },
                              startX: e.clientX,
                              startY: e.clientY,
                              x: e.clientX,
                              y: e.clientY,
                              active: false,
                            });
                          }}
                          onClick={(e) => {
                            if (justDragged.current) return;
                            if (e.shiftKey && selected?.kind === "expr" && ref.kind === "expr") {
                              const r = rangeBetween(program, selected, ref);
                              if (r) {
                                setRange(r);
                                return;
                              }
                            }
                            select(ref);
                          }}
                        />
                      );
                    })}

                  {/* Élément en cours de déplacement */}
                  {draggedRef &&
                    elements
                      .filter((s) => sameRef(draggedRef, refOf(n, s.ref)))
                      .map((s) => {
                        const b = shapeBox(s);
                        return (
                          <rect
                            key="dragged"
                            x={b.x}
                            y={b.y}
                            width={b.w}
                            height={b.h}
                            rx={4}
                            className="pointer-events-none fill-slate-950/60 stroke-slate-500"
                            strokeDasharray="4 3"
                          />
                        );
                      })}

                  {/* Zones de dépôt */}
                  {tool &&
                    !coilTool &&
                    elements
                      .filter((s) => s.ref.path !== undefined && !sameRef(draggedRef, refOf(n, s.ref)))
                      .flatMap((shape) => {
                        const w = shapeWidth(shape);
                        const base = { n, r: shape.ref.rung, path: shape.ref.path as number[] };
                        const zones: [Zone, number, number, number, number][] = [
                          [{ t: "series", ...base, side: "before" }, shape.x + 2, shape.y - 16, 18, 32],
                          [{ t: "series", ...base, side: "after" }, shape.x + w - 20, shape.y - 16, 18, 32],
                          [{ t: "parallel", ...base }, shape.x + 22, shape.y + 18, w - 44, 16],
                        ];
                        return zones.map(([z, x, y, zw, zh]) => (
                          <rect
                            key={zoneAttr(z)}
                            {...zoneProps(z)}
                            x={x}
                            y={y}
                            width={zw}
                            height={zh}
                            rx={3}
                            className={zoneClass(z)}
                          />
                        ));
                      })}
                  {tool && !coilTool && range && range.network === n && rangeBox && (
                    <rect
                      {...zoneProps({ t: "wrap", range })}
                      x={rangeBox.x + 10}
                      y={rangeBox.y + rangeBox.h + 2}
                      width={Math.max(rangeBox.w - 20, 40)}
                      height={14}
                      rx={3}
                      className={zoneClass({ t: "wrap", range })}
                    />
                  )}
                  {coilTool &&
                    d.rungs.map((rung) => {
                      const z: Zone = { t: "coil", n, r: rung.index };
                      return (
                        <rect
                          key={zoneAttr(z)}
                          {...zoneProps(z)}
                          x={d.coilX}
                          y={rung.top + 4}
                          width={CELL_W}
                          height={rung.height - 8}
                          rx={4}
                          className={zoneClass(z)}
                        />
                      );
                    })}
                </svg>
              </div>
              <NewRungZone
                zone={{ t: "rung", n }}
                active={!!tool && !(tool.src === "move" && coilTool)}
                hover={hover}
                zoneProps={zoneProps}
                label="nouveau rung"
              />
            </section>
          );
        })}
        <NewRungZone
          zone={{ t: "rung", n: program.networks.length }}
          active={!!tool && !(tool.src === "move" && coilTool)}
          hover={hover}
          zoneProps={zoneProps}
          label={program.networks.length === 0 ? "premier réseau : dépose un symbole ici" : "nouveau réseau"}
          always={program.networks.length === 0}
        />
      </div>

      {drag?.active && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-sky-500 bg-slate-900/90 px-2 py-1 font-mono text-xs text-emerald-300 shadow-lg"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {drag.payload.src === "move" ? "↔ " : ""}
          {drag.payload.label}
        </div>
      )}
    </div>
  );
}

function NewRungZone({
  zone,
  active,
  hover,
  zoneProps,
  label,
  always = false,
}: {
  zone: Zone;
  active: boolean;
  hover: Zone | null;
  zoneProps: (z: Zone) => Record<string, unknown>;
  label: string;
  always?: boolean;
}) {
  if (!active && !always) return null;
  const isHover = sameZone(hover, zone);
  return (
    <div
      {...zoneProps(zone)}
      className={`mt-2 rounded border border-dashed px-3 py-2 text-center text-xs ${
        isHover ? "border-sky-300 bg-sky-500/30 text-sky-100" : "border-sky-700 bg-sky-500/10 text-sky-300"
      } ${active ? "cursor-copy" : ""}`}
    >
      + {label}
    </div>
  );
}
