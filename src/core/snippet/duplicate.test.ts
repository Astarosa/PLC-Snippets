import { describe, expect, it } from "vitest";
import { sampleSnippets } from "../../storage/sample-library";
import { copyId, duplicateSnippet } from "./duplicate";
import { parseRawSnippet } from "./parse";

describe("dupliquer un snippet", () => {
  it("trouve un identifiant libre", () => {
    expect(copyId("tempo", [])).toBe("tempo-copie");
    expect(copyId("tempo", ["tempo-copie"])).toBe("tempo-copie-2");
    expect(copyId("tempo-copie", ["tempo-copie", "tempo-copie-2"])).toBe("tempo-copie-3");
  });

  it("copie tout le contenu, avec un nouveau titre et de nouvelles dates", () => {
    const raw = sampleSnippets()[1];
    const parsed = parseRawSnippet(raw);
    if (!parsed.ok) throw new Error();
    const copy = duplicateSnippet(parsed.snippet, [parsed.snippet.id], "2026-11-26T15:00:00.000Z");
    const back = parseRawSnippet(copy);
    if (!back.ok) throw new Error(back.invalid.errors.join());
    expect(back.snippet.id).toBe(`${parsed.snippet.id}-copie`);
    expect(back.snippet.meta.title).toBe(`${parsed.snippet.meta.title} (copie)`);
    expect(back.snippet.meta.createdAt).toBe("2026-11-26T15:00:00.000Z");
    expect(back.snippet.variants).toEqual(parsed.snippet.variants);
    expect(back.snippet.meta.plcTags).toEqual(parsed.snippet.meta.plcTags);
    expect(back.snippet.readme).toBe(parsed.snippet.readme);
  });
});
