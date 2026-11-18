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

  it("place une boîte sur 2 cellules et continue le fil après Q", () => {
    const d = layout('NO "Capteur" & TON #Tempo PT=T#5S ET=#Ecoule & NO "Auto" -> COIL "Defaut"');
    const [box] = ofKind(d.shapes, "box");
    expect(box).toMatchObject({
      title: "TON",
      instance: "#Tempo",
      mainIn: "IN",
      mainOut: "Q",
      x: RAIL_X + CELL_W,
    });
    expect(box.params).toEqual([
      { name: "PT", value: "T#5S", direction: "in" },
      { name: "ET", value: "#Ecoule", direction: "out" },
    ]);
    const auto = ofKind(d.shapes, "contact").find((c) => c.label === '"Auto"');
    expect(auto?.x).toBe(RAIL_X + 3 * CELL_W);
    // Deux paramètres : la boîte occupe deux lignes, le rung aussi.
    expect(d.height).toBeGreaterThan(2 * 76 - 10);
  });

  it("dessine fronts et comparateurs comme des contacts", () => {
    const d = layout('P "Bp" MEM="M_Bp" & CMP "Niveau" > 80 -> COIL "X"');
    expect(ofKind(d.shapes, "edge")[0]).toMatchObject({ variant: "P", label: '"Bp"', memory: '"M_Bp"' });
    expect(ofKind(d.shapes, "compare")[0]).toMatchObject({
      op: ">",
      left: '"Niveau"',
      right: "80",
      x: RAIL_X + CELL_W,
    });
  });

  it("accepte un rung sans bobine qui finit par une boîte", () => {
    const d = layout('NO "Dcy" & MOVE IN=10 OUT="Consigne"');
    expect(ofKind(d.shapes, "coil")).toHaveLength(0);
    expect(d.width).toBe(RAIL_X + 3 * CELL_W + RAIL_X);
  });
});

describe("adresses des éléments (éditeur visuel)", () => {
  it("donne à chaque élément son chemin et à chaque bobine son index", () => {
    const d = layout('NO "A" & ( NO "B" | NO "C" ) -> COIL "X", SET "Y"\nNO "D" -> COIL "Z"');
    const refs = d.shapes
      .filter((s) => "ref" in s && s.ref)
      .map((s) => ["label" in s ? s.label : "", JSON.stringify((s as { ref: unknown }).ref)]);
    expect(refs).toEqual([
      ['"A"', '{"rung":0,"path":[0]}'],
      ['"B"', '{"rung":0,"path":[1,0]}'],
      ['"C"', '{"rung":0,"path":[1,1]}'],
      ['"X"', '{"rung":0,"output":0}'],
      ['"Y"', '{"rung":0,"output":1}'],
      ['"D"', '{"rung":1,"path":[]}'],
      ['"Z"', '{"rung":1,"output":0}'],
    ]);
    expect(d.rungs.map((r) => r.index)).toEqual([0, 1]);
    expect(d.coilX).toBe(RAIL_X + 3 * CELL_W);
  });
});
