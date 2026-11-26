import { describe, expect, it } from "vitest";
import { checkLadderSource } from "../ladder/check";
import { formToRaw, generateScl } from "./form";
import { TEMPLATES } from "./templates";

describe("modèles de snippet", () => {
  it.each(TEMPLATES.filter((t) => t.id !== "vide"))(
    "$label : LADDER sans problème, SCL généré, enregistrable",
    (t) => {
      const form = t.build();
      const diagnostics = checkLadderSource(form.lad.content, {
        blockType: form.blockType,
        iface: form.interface,
        plcTags: form.plcTags,
      });
      expect(diagnostics).toEqual([]);
      expect(generateScl(form.lad.content).ok).toBe(true);
      const raw = formToRaw(form, "2026-01-01T00:00:00.000Z");
      expect(raw.ok ? [] : raw.errors).toEqual([]);
    },
  );

  it("chaque appel donne un formulaire neuf", () => {
    const t = TEMPLATES[1];
    const a = t.build();
    a.plcTags.push({ name: "X", type: "Bool" });
    expect(t.build().plcTags).not.toContainEqual({ name: "X", type: "Bool" });
  });
});
