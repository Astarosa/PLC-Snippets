import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Expr, LadProgram, Output } from "../../core/ladder/ast";
import {
  addOutput,
  addRung,
  canRemoveOutput,
  type ElementRef,
  insertParallel,
  insertSeries,
  newElement,
  newOutput,
  normalizeProgram,
  type PaletteItem,
  removeExpr,
  removeOutput,
  setNetworkTitle,
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
import { Inspector } from "./Inspector";
import { ShapeView } from "./LadderDiagram";
import { PALETTE, type PaletteEntry } from "./palette";

/* Zones de dépôt : où un symbole de la palette peut être posé. */
type Zone =
  | { t: "series"; n: number; r: number; path: number[]; side: "before" | "after" }
  | { t: "parallel"; n: number; r: number; path: number[] }
  | { t: "coil"; n: number; r: number }
  | { t: "rung"; n: number };

/** Formes qui représentent un élément éditable (contacts, boîtes, bobines…). */
type ElementShape = Extract<Shape, { ref?: ShapeRef }> & { ref: ShapeRef };

const zoneAttr = (z: Zone) => JSON.stringify(z);
const sameZone = (a: Zone | null, b: Zone) => a !== null && zoneAttr(a) === zoneAttr(b);

/** Applique un dépôt ; renvoie le programme et l'objet créé (pour le sélectionner). */
function applyDrop(
  program: LadProgram,
  zone: Zone,
  item: PaletteItem,
): { program: LadProgram; created: Expr | Output } {
  if (zone.t === "coil") {
    if (item.kind !== "coil") throw new Error("seules les bobines vont dans la colonne des bobines");
    const output = newOutput(item.variant);
    return { program: addOutput(program, zone.n, zone.r, output), created: output };
  }
  if (zone.t === "rung") {
    const next = normalizeProgram(addRung(program, zone.n, item));
    const network = next.networks[Math.min(zone.n, next.networks.length - 1)];
    const rung = network.rungs[network.rungs.length - 1];
    return { program: next, created: item.kind === "coil" ? rung.outputs[0] : rung.condition };
  }
  if (item.kind === "coil") throw new Error("une bobine se dépose dans la colonne des bobines");
  const element = newElement(item);
  const ref = { network: zone.n, rung: zone.r, path: zone.path };
  const next =
    zone.t === "series"
      ? insertSeries(program, ref, zone.side, element)
      : insertParallel(program, ref, element);
  return { program: next, created: element };
}

/** Retrouve l'adresse d'un élément (par identité) après une modification. */
function findRef(program: LadProgram, target: Expr | Output): ElementRef | null {
  for (const [n, network] of program.networks.entries()) {
    for (const [r, rung] of network.rungs.entries()) {
      const o = rung.outputs.indexOf(target as Output);
      if (o >= 0) return { kind: "output", network: n, rung: r, output: o };
      const search = (e: Expr, path: number[]): number[] | null => {
        if (e === target) return path;
        const list = e.type === "series" ? e.items : e.type === "parallel" ? e.branches : [];
        for (const [i, child] of list.entries()) {
          const found = search(child, [...path, i]);
          if (found) return found;
        }
        return null;
      };
      const path = search(rung.condition, []);
      if (path) return { kind: "expr", network: n, rung: r, path };
    }
  }
  return null;
}

const refMatches = (sel: ElementRef | null, n: number, ref: ShapeRef) =>
  sel !== null &&
  sel.network === n &&
  sel.rung === ref.rung &&
  (sel.kind === "output" ? sel.output === ref.output : JSON.stringify(sel.path) === JSON.stringify(ref.path));

function shapeWidth(shape: ElementShape) {
  return shape.kind === "box" ? BOX_CELLS * CELL_W : CELL_W;
}

/**
 * Éditeur LADDER visuel : palette de symboles à glisser (ou cliquer puis poser),
 * sélection et inspecteur. Le texte DSL reste la référence : chaque modification
 * le réécrit, et l'onglet Texte reste disponible.
 */
export function VisualEditor({ source, onChange }: { source: string; onChange: (source: string) => void }) {
  const parsed = useMemo(() => (source.trim() ? parseLadder(source) : null), [source]);
  const program = useMemo<LadProgram | null>(() => {
    if (parsed === null) return { networks: [] };
    return parsed.ok ? normalizeProgram(parsed.program) : null;
  }, [parsed]);

  const [selected, setSelected] = useState<ElementRef | null>(null);
  const [armed, setArmed] = useState<PaletteItem | null>(null);
  const [drag, setDrag] = useState<{ entry: PaletteEntry; x: number; y: number; active: boolean } | null>(
    null,
  );
  const [hover, setHover] = useState<Zone | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const tool = drag?.active ? drag.entry.item : armed;

  const commit = useCallback(
    (next: LadProgram, select?: Expr | Output) => {
      onChange(printLadder(next));
      setSelected(select ? findRef(next, select) : null);
    },
    [onChange],
  );

  const drop = useCallback(
    (zone: Zone, item: PaletteItem) => {
      if (!program) return;
      try {
        const { program: next, created } = applyDrop(program, zone, item);
        commit(next, created);
      } catch {
        // Dépôt incompatible (bobine hors de la colonne des bobines…) : ignoré.
      }
    },
    [program, commit],
  );

  // Glisser-déposer à la souris (pointer events : fiable dans toutes les webviews).
  useEffect(() => {
    if (!drag) return;
    const zoneAt = (x: number, y: number): Zone | null => {
      const el = document.elementFromPoint(x, y)?.closest("[data-zone]");
      return el ? (JSON.parse(el.getAttribute("data-zone") as string) as Zone) : null;
    };
    const move = (e: PointerEvent) => {
      const start = startRef.current;
      const active =
        drag.active || (start !== null && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5);
      setDrag({ ...drag, x: e.clientX, y: e.clientY, active });
      setHover(active ? zoneAt(e.clientX, e.clientY) : null);
    };
    const up = (e: PointerEvent) => {
      if (drag.active) {
        const zone = zoneAt(e.clientX, e.clientY);
        if (zone) drop(zone, drag.entry.item);
        setArmed(null);
      } else {
        // Simple clic sur la palette : le symbole est « armé », on clique ensuite sur une zone.
        setArmed((a) =>
          a && JSON.stringify(a) === JSON.stringify(drag.entry.item) ? null : drag.entry.item,
        );
      }
      setDrag(null);
      setHover(null);
      startRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, drop]);

  // Clavier : Échap annule, Suppr efface la sélection.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, .cm-editor");
      if (e.key === "Escape") {
        setArmed(null);
        setSelected(null);
      }
      if (!typing && program && selected && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        if (selected.kind === "expr") commit(removeExpr(program, selected));
        else if (canRemoveOutput(program, selected)) commit(removeOutput(program, selected));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [program, selected, commit]);

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
  const zoneStyle = (z: Zone) =>
    sameZone(hover, z) ? "fill-sky-400/50 stroke-sky-300" : "fill-sky-500/15 stroke-sky-500/60";

  return (
    <div className="grid grid-cols-[150px_1fr] gap-3">
      {/* Palette */}
      <aside className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/60 p-2 select-none">
        {PALETTE.map((group) => (
          <div key={group.title}>
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {group.title}
            </p>
            <div className="grid grid-cols-2 gap-1">
              {group.entries.map((entry) => {
                const isArmed = armed !== null && JSON.stringify(armed) === JSON.stringify(entry.item);
                return (
                  <button
                    key={entry.label}
                    type="button"
                    title={`${entry.hint} — glisse-le dans le réseau, ou clique puis clique sur une zone`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      startRef.current = { x: e.clientX, y: e.clientY };
                      setDrag({ entry, x: e.clientX, y: e.clientY, active: false });
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

      {/* Réseaux */}
      <div className="min-w-0 space-y-3">
        {/* Inspecteur : bandeau collé en haut pendant le défilement */}
        <aside className="sticky top-0 z-10 min-h-[100px] rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-lg shadow-slate-950">
          {selected ? (
            <Inspector
              key={JSON.stringify(selected)}
              program={program}
              selected={selected}
              // Modifier un élément ne change pas son adresse : il reste sélectionné.
              onChange={(next) => onChange(printLadder(next))}
              onDeleted={() => setSelected(null)}
            />
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
              <p>Glisse un symbole de la palette dans le réseau, ou clique dessus puis sur une zone bleue.</p>
              <p>Clique sur un élément pour modifier son opérande et ses paramètres. Suppr pour l'effacer.</p>
              <p>
                Les éléments ajoutés portent <code className="text-slate-400">"???"</code> : remplace-le par
                ta variable.
              </p>
            </div>
          )}
        </aside>

        {program.networks.map((network, n) => {
          const d = layoutNetwork(network);
          const elements = d.shapes.filter((s): s is ElementShape => "ref" in s && s.ref !== undefined);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: les réseaux n'ont pas d'identifiant propre
            <section key={n} className="rounded-lg border border-slate-700 bg-slate-900/60 p-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-500">Réseau {n + 1}</span>
                <input
                  key={network.title ?? ""}
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
              </div>
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
                    .filter((s) => s.kind !== "title")
                    .map((shape, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: formes recalculées à chaque rendu
                      <ShapeView key={i} shape={shape} />
                    ))}

                  {/* Cibles de sélection */}
                  {!tool &&
                    elements.map((shape, i) => {
                      const isSel = refMatches(selected, n, shape.ref);
                      const w = shapeWidth(shape);
                      const top = shape.y - 34;
                      const h = shape.kind === "box" ? 34 + boxBottom(shape.params.length) + 4 : 68;
                      return (
                        // biome-ignore lint/a11y/noStaticElementInteractions: élément graphique sélectionnable au clic
                        <rect
                          // biome-ignore lint/suspicious/noArrayIndexKey: une cible par forme
                          key={`sel-${i}`}
                          x={shape.x + 4}
                          y={top}
                          width={w - 8}
                          height={h}
                          rx={4}
                          className={`cursor-pointer ${isSel ? "fill-sky-400/10 stroke-sky-400" : "fill-transparent stroke-transparent hover:stroke-slate-500"}`}
                          strokeDasharray={isSel ? undefined : "3 3"}
                          onClick={() =>
                            setSelected(
                              shape.ref.output !== undefined
                                ? {
                                    kind: "output",
                                    network: n,
                                    rung: shape.ref.rung,
                                    output: shape.ref.output,
                                  }
                                : {
                                    kind: "expr",
                                    network: n,
                                    rung: shape.ref.rung,
                                    path: shape.ref.path ?? [],
                                  },
                            )
                          }
                        />
                      );
                    })}

                  {/* Zones de dépôt */}
                  {tool &&
                    tool.kind !== "coil" &&
                    elements
                      .filter((s) => s.ref.path !== undefined)
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
                            className={`cursor-copy ${zoneStyle(z)}`}
                          />
                        ));
                      })}
                  {tool?.kind === "coil" &&
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
                          className={`cursor-copy ${zoneStyle(z)}`}
                        />
                      );
                    })}
                </svg>
              </div>
              <NewRungZone
                zone={{ t: "rung", n }}
                active={!!tool}
                hover={hover}
                zoneProps={zoneProps}
                label="nouveau rung"
              />
            </section>
          );
        })}
        <NewRungZone
          zone={{ t: "rung", n: program.networks.length }}
          active={!!tool}
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
          {drag.entry.glyph} {drag.entry.label}
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
