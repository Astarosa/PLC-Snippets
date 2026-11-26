import { invoke } from "@tauri-apps/api/core";

/**
 * Ouvre le dossier d'un snippet dans l'explorateur. Le chemin est construit et vérifié côté
 * Rust (dossier de snippet de la bibliothèque uniquement).
 */
export const openSnippetFolder = (library: string, id: string) =>
  invoke<void>("open_snippet_folder", { library, id });
