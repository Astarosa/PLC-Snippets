import { describe, expect, it } from "vitest";
import { CELL_W, layoutNetwork, RAIL_X, type Shape } from "./layout";
import { parseLadder } from "./parse";

function layout(source: string) {
  const result = parseLadder(source);
  if (!result.ok) throw new Error(result.error.message);
  return layoutNetwork(result.program.networks[0]);
}
const ofKind = <K extends Shape["kind"]>(shapes: Shape[], kind: K) =>
  shapes.filter((s): s is Extract<Shape, { kind: K }> => s.kind === kind);

describe("layoutNetwork", () => {
  it("place un auto-maintien : 2 branches parallèles puis 2 contacts en série", () => {
    const d = layout('( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" & NC "Defaut" -> COIL "KM1"');
    const contacts = ofKind(d.shapes, "contact");
    expect(contacts.map((c) => c.label)).toEqual(['"BP_Marche"', '"KM1"', '"BP_Arret"', '"Defaut"']);
    // Les deux branches sont dans la même colonne, l'une sous l'autre.
    expect(contacts[0].x).toBe(contacts[1].x);
    expect(contacts[1].y).toBeGreaterThan(contacts[0].y);
    // Les contacts en série sont sur le fil principal, colonnes 1 et 2.
    expect(contacts[2].x).toBe(RAIL_X + CELL_W);
    expect(contacts[3]).toMatchObject({ x: RAIL_X + 2 * CELL_W, y: contacts[0].y, variant: "NC" });
    // Bobine alignée sur le fil principal, après la condition.
    const [coil] = ofKind(d.shapes, "coil");
    expect(coil).toMatchObject({ variant: "COIL", y: contacts[0].y });
    expect(coil.x).toBeGreaterThan(contacts[3].x);
    // Deux fils verticaux ferment la parallèle.
    const verticals = ofKind(d.shapes, "wire").filter((w) => w.x1 === w.x2);
    expect(verticals.map((w) => w.x1).sort((a, b) => a - b)).toEqual([RAIL_X, RAIL_X + CELL_W]);
  });

  it("prolonge la branche la plus courte", () => {
    const d = layout('NO "A" & NO "B" | NO "C" -> COIL "X"');
    const horizontals = ofKind(d.shapes, "wire").filter((w) => w.y1 === w.y2);
    const cY = ofKind(d.shapes, "contact").find((c) => c.label === '"C"')?.y;
    expect(
      horizontals.some((w) => w.y1 === cY && w.x1 === RAIL_X + CELL_W && w.x2 === RAIL_X + 2 * CELL_W),
    ).toBe(true);
  });

  it("empile plusieurs bobines et aligne les bobines de tous les rungs", () => {
    const d = layout('NO "A" -> COIL "X", SET "Y"\nNO "B" & NO "C" & NO "D" -> RESET "Y"');
    const coils = ofKind(d.shapes, "coil");
    expect(coils.map((c) => c.variant)).toEqual(["COIL", "SET", "RESET"]);
    expect(new Set(coils.map((c) => c.x)).size).toBe(1);
    expect(d.width).toBeGreaterThan(coils[0].x);
    expect(d.height).toBeGreaterThan(coils[2].y);
  });
});
