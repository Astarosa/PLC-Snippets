import { ID_PATTERN } from "../snippet/form";
import { parseRawSnippet, type RawSnippet, slugify, snippetToRaw } from "../snippet/parse";
import type { FormatAdapter, ImportItem, ImportSource, SourceFile } from "./types";

/*
 * Format natif, complet : un dossier par snippet (snippet.json, README.md, main.lad / .scl / .awl),
 * dans un zip pour l'envoyer, ou tel quel. Les anciens formats sont migrés à la lecture.
 */

const CODE_FILE = /\.(lad|scl|awl)$/;
const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Nom de dossier utilisable comme identifiant, sinon dérivé du titre ou du nom de la source. */
function pickId(dir: string, title: unknown, sourceName: string): string {
  const fromDir = basename(dir);
  if (ID_PATTERN.test(fromDir)) return fromDir;
  const candidate = slugify(
    typeof title === "string" && title ? title : fromDir || sourceName.replace(/\.zip$/i, ""),
  );
  return candidate || "snippet-importe";
}

function readTitle(meta: string): unknown {
  try {
    return (JSON.parse(meta) as { title?: unknown }).title;
  } catch {
    return undefined;
  }
}

export function importPlcSnippets(source: ImportSource): ImportItem[] {
  const dirs = source.files.filter((f) => basename(f.path) === "snippet.json").map((f) => dirname(f.path));
  return dirs.map((dir): ImportItem => {
    const inDir = (f: SourceFile) => dirname(f.path) === dir;
    const meta = source.files.find((f) => inDir(f) && basename(f.path) === "snippet.json") as SourceFile;
    const readme = source.files.find((f) => inDir(f) && basename(f.path) === "README.md");
    const raw: RawSnippet = {
      id: pickId(dir, readTitle(meta.content), source.name),
      meta: meta.content,
      readme: readme?.content ?? null,
      files: source.files
        .filter((f) => inDir(f) && CODE_FILE.test(f.path))
        .map((f) => ({ name: basename(f.path), content: f.content })),
    };
    const parsed = parseRawSnippet(raw);
    return parsed.ok
      ? { origin: dir || source.name, id: raw.id, snippet: parsed.snippet, errors: [], warnings: [] }
      : {
          origin: dir || source.name,
          id: raw.id,
          snippet: null,
          errors: parsed.invalid.errors,
          warnings: [],
        };
  });
}

export const plcSnippetsAdapter: FormatAdapter = {
  id: "plcsnippets",
  label: "PLC Snippets (.zip)",
  family: "Partager",
  lossless: true,
  keeps: "complet",
  detect: (source) => source.files.some((f) => basename(f.path) === "snippet.json"),
  import: importPlcSnippets,
  canExport: () => null,
  export(snippets) {
    const files = snippets.flatMap((snippet) => {
      const raw = snippetToRaw(snippet);
      return [
        { path: `${raw.id}/snippet.json`, content: raw.meta },
        ...(raw.readme ? [{ path: `${raw.id}/README.md`, content: raw.readme }] : []),
        ...raw.files.map((f) => ({ path: `${raw.id}/${f.name}`, content: f.content })),
      ];
    });
    const fileName = snippets.length === 1 ? `${snippets[0].id}.zip` : `plc-snippets-${snippets.length}.zip`;
    return { kind: "zip", fileName, files, warnings: [] };
  },
};
