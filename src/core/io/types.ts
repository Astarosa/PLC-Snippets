import type { RawSnippet } from "../snippet/parse";
import type { Snippet } from "../snippet/schema";
import type { Mnemonic } from "../stl/mnemonics";

/** Fichier texte lu ou écrit (chemin relatif, séparateur « / »). */
export interface SourceFile {
  path: string;
  content: string;
}

/** Ce que le Rust a lu : un zip, un dossier ou un fichier (voir src-tauri/src/transfer.rs). */
export interface ImportSource {
  kind: "zip" | "dir" | "file";
  name: string;
  files: SourceFile[];
  skipped: string[];
}

/** Un snippet trouvé dans la source, prêt à être importé (ou refusé avec ses erreurs). */
export interface ImportItem {
  /** Chemin d'origine dans la source (pour l'affichage). */
  origin: string;
  /** Identifiant proposé (nom de dossier). */
  id: string;
  snippet: Snippet | null;
  errors: string[];
  /** Ce qui sera perdu ou à compléter (formats avec perte). */
  warnings: string[];
}

export interface ImportPreview {
  format: { id: string; label: string; lossless: boolean } | null;
  sourceName: string;
  items: ImportItem[];
  /** Avertissements sur la source entière (fichiers ignorés…). */
  warnings: string[];
}

export type ExportResult =
  | { kind: "zip"; fileName: string; files: SourceFile[]; warnings: string[] }
  | { kind: "text"; fileName: string; content: string; extension: string; warnings: string[] };

export interface FormatAdapter {
  id: string;
  label: string;
  /** Groupe dans le menu « Exporter ▾ ». */
  family: "Partager" | "TIA Portal" | "Schneider / CODESYS";
  /** true : rien n'est perdu (format PLC Snippets). false : passerelle avec perte. */
  lossless: boolean;
  /** Résumé court de ce que le format conserve (affiché dans le menu). */
  keeps: string;
  /** Prévu mais pas encore disponible (affiché grisé). */
  planned?: boolean;
  detect?(source: ImportSource): boolean;
  import?(source: ImportSource): ImportItem[];
  /** Le format accepte-t-il ce snippet ? (sinon raison) */
  canExport?(snippet: Snippet): string | null;
  export?(snippets: Snippet[], options?: ExportPreferences): ExportResult;
}

/** Réglages de l'utilisateur pris en compte à l'export (mémorisés dans l'app). */
export interface ExportPreferences {
  /** Sources LIST (.awl) : mnémonique du projet TIA cible. */
  stlMnemonic?: Mnemonic;
}

export type { RawSnippet };
