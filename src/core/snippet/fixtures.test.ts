/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CURRENT_VERSION } from "./migrate";
import { parseRawSnippet, type RawSnippet } from "./parse";

/*
 * Garantie de compatibilité : chaque snippet de fixtures/vN (format figé d'une ancienne
 * version) doit se lire avec l'application actuelle, après migration.
 */

const ROOT = fileURLToPath(new URL("../../../fixtures", import.meta.url));

function readSnippetDir(dir: string, id: string): RawSnippet {
  const files = readdirSync(dir)
    .filter((f) => /\.(lad|scl|awl)$/.test(f))
    .sort()
    .map((name) => ({ name, content: readFileSync(join(dir, name), "utf8") }));
  const readme = join(dir, "README.md");
  return {
    id,
    meta: readFileSync(join(dir, "snippet.json"), "utf8"),
    readme: existsSync(readme) ? readFileSync(readme, "utf8") : null,
    files,
  };
}

const versions = readdirSync(ROOT).filter((d) => /^v\d+$/.test(d));

describe("fixtures de compatibilité", () => {
  it("existent pour chaque version du format jusqu'à la version courante", () => {
    for (let v = 1; v <= CURRENT_VERSION; v++) expect(versions).toContain(`v${v}`);
  });

  for (const version of versions) {
    const dir = join(ROOT, version);
    for (const id of readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory())) {
      it(`${version}/${id} se lit avec le format v${CURRENT_VERSION}`, () => {
        const result = parseRawSnippet(readSnippetDir(join(dir, id), id));
        if (!result.ok) throw new Error(result.invalid.errors.join("\n"));
        expect(result.snippet.meta.schemaVersion).toBe(CURRENT_VERSION);
      });
    }
  }
});
