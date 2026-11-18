import { z } from "zod";
import { CURRENT_VERSION } from "./migrate";

// Messages de validation en français.
z.config(z.locales.fr());

/**
 * Format de `snippet.json` (version 1).
 *
 * Le code n'est pas stocké ici : chaque variante pointe vers un fichier
 * (`main.lad`, `main.scl`, `main.awl`) du même dossier. Le fichier `.scl` contient
 * uniquement le CORPS du bloc (ce qu'on colle dans l'éditeur SCL de TIA),
 * l'interface est décrite à part, pour pouvoir l'afficher en tableau et
 * générer plus tard la source externe complète (FUNCTION_BLOCK … END_VAR).
 */

export const LANGS = ["LAD", "SCL", "STL"] as const;
export const MNEMONICS = ["DE", "EN"] as const;
export const BLOCK_TYPES = ["FC", "FB", "NETWORK"] as const;
export const CPU_FAMILIES = ["S7-1200", "S7-1500", "S7-300/400"] as const;

export const variableSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  initial: z.string().optional(),
  comment: z.string().optional(),
});

export const interfaceSchema = z.object({
  input: z.array(variableSchema).default([]),
  output: z.array(variableSchema).default([]),
  inOut: z.array(variableSchema).default([]),
  static: z.array(variableSchema).default([]),
  temp: z.array(variableSchema).default([]),
  constant: z.array(variableSchema).default([]),
});

export const variantSchema = z.object({
  lang: z.enum(LANGS),
  file: z.string().regex(/^[a-z0-9][a-z0-9_-]*\.(lad|scl|awl)$/, "Nom de fichier invalide"),
  /** LIST uniquement : mnémonique du texte enregistré (allemand SIMATIC ou anglais). */
  mnemonic: z.enum(MNEMONICS).optional(),
  /** true si le SCL a été généré depuis le LADDER (ne pas l'éditer à la main). */
  generated: z.boolean().default(false),
});

export const snippetMetaSchema = z.object({
  schemaVersion: z.literal(CURRENT_VERSION),
  title: z.string().min(1, "Le titre est obligatoire"),
  summary: z.string().default(""),
  tags: z.array(z.string().min(1)).default([]),
  blockType: z.enum(BLOCK_TYPES),
  cpuFamilies: z.array(z.enum(CPU_FAMILIES)).default([]),
  tiaVersion: z.string().optional(),
  interface: interfaceSchema.default({
    input: [],
    output: [],
    inOut: [],
    static: [],
    temp: [],
    constant: [],
  }),
  variants: z.array(variantSchema).min(1, "Au moins une variante (LAD, SCL ou LIST)"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Lang = (typeof LANGS)[number];
export const LANG_LABELS: Record<Lang, string> = { LAD: "LADDER", SCL: "SCL", STL: "LIST" };
export const LANG_SHORT: Record<Lang, string> = { LAD: "LAD", SCL: "SCL", STL: "LIST" };
export type BlockType = (typeof BLOCK_TYPES)[number];
export type CpuFamily = (typeof CPU_FAMILIES)[number];
export type Variable = z.infer<typeof variableSchema>;
export type SnippetInterface = z.infer<typeof interfaceSchema>;
export type SnippetMeta = z.infer<typeof snippetMetaSchema>;
/** Ce qu'on écrit sur le disque : les champs avec valeur par défaut deviennent optionnels. */
export type SnippetMetaInput = z.input<typeof snippetMetaSchema>;

export type SnippetVariant = z.infer<typeof variantSchema> & { content: string };

/** Snippet complet, prêt pour l'interface. */
export interface Snippet {
  id: string;
  meta: SnippetMeta;
  readme: string | null;
  variants: SnippetVariant[];
}

/** Dossier présent dans la bibliothèque mais illisible (JSON cassé, fichier manquant…). */
export interface InvalidSnippet {
  id: string;
  errors: string[];
}

export const INTERFACE_SECTIONS: { key: keyof SnippetInterface; label: string }[] = [
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "inOut", label: "InOut" },
  { key: "static", label: "Static" },
  { key: "temp", label: "Temp" },
  { key: "constant", label: "Constant" },
];
