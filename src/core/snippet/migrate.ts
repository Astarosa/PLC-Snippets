/*
 * Migrations du format des snippets.
 *
 * Chaque snippet.json porte "schemaVersion". Quand le format change (snippet.json
 * OU syntaxe d'un fichier .lad / .scl / .awl), on :
 *   1. incrémente CURRENT_VERSION,
 *   2. ajoute MIGRATIONS[ancienne version] qui produit la version suivante,
 *   3. ajoute un exemple figé dans fixtures/v<ancienne version>/ (voir CONTRIBUTING.md).
 *
 * Les migrations s'enchaînent (v1 → v2 → v3…) et s'appliquent à la lecture : bibliothèque
 * et import. Un snippet plus récent que l'app est refusé, jamais deviné.
 */

export const CURRENT_VERSION = 2 as const;

/** Snippet en cours de migration : snippet.json déjà lu, fichiers bruts. */
export interface MigratableSnippet {
  meta: Record<string, unknown>;
  readme: string | null;
  files: { name: string; content: string }[];
}

/** Transforme un snippet de la version N (la clé) en version N + 1. */
export type Migration = (snippet: MigratableSnippet) => MigratableSnippet;

export const MIGRATIONS: Record<number, Migration> = {
  // v2 : table des variables API (plcTags), vide pour les anciens snippets.
  1: (s) => ({ ...s, meta: { ...s.meta, schemaVersion: 2, plcTags: [] } }),
};

export type MigrationResult =
  | { ok: true; snippet: MigratableSnippet; from: number }
  | { ok: false; error: string };

export function migrateSnippet(
  input: MigratableSnippet,
  migrations: Record<number, Migration> = MIGRATIONS,
  current: number = CURRENT_VERSION,
): MigrationResult {
  const version = input.meta.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "schemaVersion absent ou invalide dans snippet.json" };
  }
  if (version > current) {
    return {
      ok: false,
      error: `Format v${version} : snippet créé avec une version plus récente de PLC Snippets (format v${current} ici). Mets l'application à jour.`,
    };
  }

  let snippet = input;
  for (let v = version; v < current; v++) {
    const step = migrations[v];
    if (!step) return { ok: false, error: `Migration manquante du format v${v} vers v${v + 1}` };
    snippet = step(snippet);
    if (snippet.meta.schemaVersion !== v + 1) {
      return { ok: false, error: `La migration v${v} → v${v + 1} n'a pas mis à jour schemaVersion` };
    }
  }
  return { ok: true, snippet, from: version };
}
