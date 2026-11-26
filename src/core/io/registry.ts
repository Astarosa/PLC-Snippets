import { plcTagsXlsxAdapter } from "./plc-tags-xlsx";
import { plcSnippetsAdapter } from "./plcsnippets";
import { simaticMlAdapter } from "./simaticml/adapter";
import { tiaAwlAdapter, tiaSclAdapter } from "./tia-source";
import type { FormatAdapter, ImportPreview, ImportSource } from "./types";

/**
 * Formats connus, dans l'ordre de détection à l'import (le format complet d'abord).
 * Ajouter un format = ajouter un adaptateur ici : menus et import s'adaptent seuls.
 */
export const ADAPTERS: FormatAdapter[] = [
  plcSnippetsAdapter,
  tiaSclAdapter,
  tiaAwlAdapter,
  simaticMlAdapter,
  plcTagsXlsxAdapter,
  {
    id: "plcopen",
    label: "PLCopen XML (.xml)",
    family: "Schneider / CODESYS",
    lossless: false,
    keeps: "LADDER inclus",
    planned: true,
  },
];

export const FAMILIES = ["Partager", "TIA Portal", "Schneider / CODESYS"] as const;

/** Reconnaît le format de la source et prépare l'aperçu d'import. */
export function previewImport(source: ImportSource): ImportPreview {
  const warnings = source.skipped.map((s) => `Ignoré : ${s}`);
  const adapter = ADAPTERS.find((a) => !a.planned && a.import && a.detect?.(source));
  if (!adapter?.import) {
    return {
      format: null,
      sourceName: source.name,
      items: [],
      warnings: [
        ...warnings,
        "Aucun format reconnu : il faut un snippet PLC Snippets (dossier ou zip avec snippet.json), une source externe TIA (.scl / .awl) ou un export SimaticML (.xml).",
      ],
    };
  }
  return {
    format: { id: adapter.id, label: adapter.label, lossless: adapter.lossless },
    sourceName: source.name,
    items: adapter.import(source),
    warnings,
  };
}

export const exportAdapter = (id: string) => ADAPTERS.find((a) => a.id === id && a.export && !a.planned);
