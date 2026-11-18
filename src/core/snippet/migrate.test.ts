import { describe, expect, it } from "vitest";
import { type MigratableSnippet, type Migration, migrateSnippet } from "./migrate";

const v = (schemaVersion: unknown, extra: Record<string, unknown> = {}): MigratableSnippet => ({
  meta: { schemaVersion, title: "T", ...extra },
  readme: null,
  files: [{ name: "main.lad", content: 'NO "A" -> COIL "B"' }],
});

// Migrations factices pour tester la mécanique : v1 → v2 renomme un champ, v2 → v3 réécrit un fichier.
const FAKE: Record<number, Migration> = {
  1: (s) => {
    const { titre, ...meta } = s.meta;
    return { ...s, meta: { ...meta, schemaVersion: 2, title: titre ?? meta.title } };
  },
  2: (s) => ({
    ...s,
    meta: { ...s.meta, schemaVersion: 3 },
    files: s.files.map((f) => ({ ...f, content: f.content.replace("COIL", "BOBINE") })),
  }),
};

describe("migrateSnippet", () => {
  it("ne touche pas un snippet déjà au format courant", () => {
    const input = v(3);
    expect(migrateSnippet(input, FAKE, 3)).toEqual({ ok: true, snippet: input, from: 3 });
  });

  it("enchaîne les migrations jusqu'au format courant", () => {
    const result = migrateSnippet(v(1, { titre: "Ancien titre" }), FAKE, 3);
    if (!result.ok) throw new Error(result.error);
    expect(result.from).toBe(1);
    expect(result.snippet.meta).toEqual({ schemaVersion: 3, title: "Ancien titre" });
    expect(result.snippet.files[0].content).toBe('NO "A" -> BOBINE "B"');
  });

  it("refuse un snippet plus récent que l'application", () => {
    const result = migrateSnippet(v(4), FAKE, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("version plus récente");
  });

  it("signale une migration manquante ou mal écrite, et une version absente", () => {
    expect(migrateSnippet(v(1), { 1: FAKE[1] }, 3)).toMatchObject({ ok: false });
    expect(migrateSnippet(v(1), { 1: (s) => s }, 2)).toMatchObject({ ok: false });
    expect(migrateSnippet(v(undefined), FAKE, 3)).toMatchObject({ ok: false });
    expect(migrateSnippet(v("1"), FAKE, 3)).toMatchObject({ ok: false });
  });
});
