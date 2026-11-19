import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { exportAdapter } from "../core/io/registry";
import type { ExportPreferences, ImportSource, SourceFile } from "../core/io/types";
import type { Snippet } from "../core/snippet/schema";

/** Lit un zip, un dossier ou un fichier (commande Rust read_import_source). */
export const readImportSource = (path: string) => invoke<ImportSource>("read_import_source", { path });

const writeZip = (path: string, files: SourceFile[]) => invoke("write_export_zip", { path, files });
const writeText = (path: string, content: string) => invoke("export_source", { path, content });

export interface ExportOutcome {
  /** null si l'utilisateur a annulé la boîte « Enregistrer sous ». */
  path: string | null;
  warnings: string[];
}

/** Exporte des snippets avec un adaptateur : choix de l'emplacement, puis écriture. */
export async function runExport(
  adapterId: string,
  snippets: Snippet[],
  preferences: ExportPreferences = {},
): Promise<ExportOutcome> {
  const adapter = exportAdapter(adapterId);
  if (!adapter?.export) throw new Error(`Format d'export inconnu : ${adapterId}`);
  const exportable = snippets.filter((s) => adapter.canExport?.(s) == null);
  const refused = snippets
    .filter((s) => !exportable.includes(s))
    .map((s) => `${s.meta.title} : ${adapter.canExport?.(s)}`);
  if (exportable.length === 0) return { path: null, warnings: refused };

  const result = adapter.export(exportable, preferences);
  const extension = result.kind === "zip" ? "zip" : result.extension;
  const path = await save({
    title: `Exporter — ${adapter.label}`,
    defaultPath: result.fileName,
    filters: [{ name: adapter.label, extensions: [extension] }],
  });
  if (!path) return { path: null, warnings: [] };
  if (result.kind === "zip") await writeZip(path, result.files);
  else await writeText(path, result.content);
  return { path, warnings: [...refused, ...result.warnings] };
}
