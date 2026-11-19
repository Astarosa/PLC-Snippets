import { defaultBlockName } from "../../export/source";
import type { Snippet } from "../../snippet/schema";
import type { ExportResult, FormatAdapter, ImportSource } from "../types";
import { isSimaticMl, readSimaticMl } from "./read";
import { SimaticMlExportError, writeSimaticMl } from "./write";

const xmlFiles = (s: ImportSource) =>
  s.files.filter((f) => f.path.toLowerCase().endsWith(".xml") && isSimaticMl(f.content));

export const simaticMlAdapter: FormatAdapter = {
  id: "simaticml",
  label: "SimaticML (.xml)",
  family: "TIA Portal",
  lossless: false,
  keeps: "LADDER (TIA V20)",
  detect: (s) => xmlFiles(s).length > 0,
  import: (s) => xmlFiles(s).map((f) => readSimaticMl(f.content, f.path)),
  canExport: (snippet: Snippet) => (snippet.variants.some((v) => v.lang === "LAD") ? null : "pas de LADDER"),
  export(snippets: Snippet[]): ExportResult {
    const warnings: string[] = [];
    const files: { path: string; content: string }[] = [];
    for (const snippet of snippets) {
      try {
        const r = writeSimaticMl(snippet, defaultBlockName(snippet));
        files.push({ path: r.fileName, content: r.xml });
        warnings.push(...r.warnings.map((w) => (snippets.length > 1 ? `${snippet.meta.title} : ${w}` : w)));
      } catch (e) {
        if (!(e instanceof SimaticMlExportError)) throw e;
        warnings.push(`${snippet.meta.title} : ${e.message}`);
      }
    }
    const unique = [...new Set(warnings)];
    if (files.length === 0) throw new Error(`Export SimaticML impossible — ${unique.join(" ; ")}`);
    if (files.length === 1) {
      return {
        kind: "text",
        fileName: files[0].path,
        extension: "xml",
        content: files[0].content,
        warnings: unique,
      };
    }
    return { kind: "zip", fileName: `simaticml-${files.length}-blocs.zip`, files, warnings: unique };
  },
};
