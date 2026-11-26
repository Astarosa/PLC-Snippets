import { migrateSnippet } from "./migrate";
import { type InvalidSnippet, type Snippet, type SnippetMetaInput, snippetMetaSchema } from "./schema";

/** Forme échangée avec le Rust (voir `src-tauri/src/library.rs`). */
export interface RawSnippet {
  id: string;
  meta: string;
  readme: string | null;
  files: { name: string; content: string }[];
}

export type ParseResult = { ok: true; snippet: Snippet } | { ok: false; invalid: InvalidSnippet };

/** Transforme un snippet brut du disque en snippet validé, ou liste ce qui ne va pas. */
export function parseRawSnippet(raw: RawSnippet): ParseResult {
  const fail = (errors: string[]): ParseResult => ({ ok: false, invalid: { id: raw.id, errors } });

  let json: unknown;
  try {
    json = JSON.parse(raw.meta);
  } catch (e) {
    return fail([`snippet.json n'est pas du JSON valide : ${(e as Error).message}`]);
  }

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return fail(["snippet.json doit contenir un objet JSON"]);
  }

  // Les anciens formats sont mis à niveau avant validation.
  const migrated = migrateSnippet({
    meta: json as Record<string, unknown>,
    readme: raw.readme,
    files: raw.files,
  });
  if (!migrated.ok) return fail([migrated.error]);

  const result = snippetMetaSchema.safeParse(migrated.snippet.meta);
  if (!result.success) {
    return fail(result.error.issues.map((i) => `${i.path.join(".") || "racine"} : ${i.message}`));
  }

  const meta = result.data;
  const errors: string[] = [];
  const variants = meta.variants.map((v) => {
    const file = migrated.snippet.files.find((f) => f.name === v.file);
    if (!file) errors.push(`Fichier ${v.file} introuvable pour la variante ${v.lang}`);
    return { ...v, content: file?.content ?? "" };
  });
  if (errors.length > 0) return fail(errors);

  return { ok: true, snippet: { id: raw.id, meta, readme: migrated.snippet.readme, variants } };
}

/** Prépare un snippet pour l'écriture sur le disque. */
export function toRawSnippet(input: {
  id: string;
  meta: SnippetMetaInput;
  readme: string | null;
  files: Record<string, string>;
}): RawSnippet {
  return {
    id: input.id,
    meta: `${JSON.stringify(input.meta, null, 2)}\n`,
    readme: input.readme,
    files: Object.entries(input.files).map(([name, content]) => ({ name, content })),
  };
}

/** Snippet validé → forme disque, au format courant (après une migration ou un import). */
export function snippetToRaw(snippet: Snippet, id: string = snippet.id): RawSnippet {
  const { variants, ...rest } = snippet.meta;
  const files: Record<string, string> = {};
  for (const v of snippet.variants) files[v.file] = v.content;
  return toRawSnippet({
    id,
    meta: {
      ...rest,
      variants: variants.map(({ lang, file, generated, mnemonic }) => ({
        lang,
        file,
        ...(lang === "SCL" ? { generated } : {}),
        ...(lang === "STL" && generated ? { generated } : {}),
        ...(mnemonic ? { mnemonic } : {}),
      })),
    },
    readme: snippet.readme,
    files,
  });
}

/** « Marche / arrêt (auto-maintien) » → « marche-arret-auto-maintien ». */
export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Recherche simple (titre, résumé, tags, code). Remplacée plus tard par SQLite FTS5. */
export function matchesQuery(snippet: Snippet, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    snippet.meta.title,
    snippet.meta.summary,
    ...snippet.meta.tags,
    ...snippet.variants.map((v) => v.content),
  ]
    .join("\n")
    .toLowerCase();
  return terms.every((t) => haystack.includes(t));
}
