import { formatLadError, parseLadder } from "../ladder/parse";
import { ladderToScl } from "../ladder/scl";
import { type RawSnippet, slugify, toRawSnippet } from "./parse";
import {
  type BlockType,
  type CpuFamily,
  type Snippet,
  type SnippetInterface,
  type SnippetMetaInput,
  snippetMetaSchema,
} from "./schema";

/** État du formulaire d'édition : volontairement « à plat » et facile à binder. */
export interface SnippetForm {
  id: string;
  title: string;
  summary: string;
  tagsText: string;
  blockType: BlockType;
  cpuFamilies: CpuFamily[];
  tiaVersion: string;
  interface: SnippetInterface;
  lad: VariantForm;
  scl: VariantForm & { generated: boolean };
  readme: string;
  createdAt: string | null;
}

export interface VariantForm {
  enabled: boolean;
  file: string;
  content: string;
}

export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export const emptyInterface = (): SnippetInterface => ({
  input: [],
  output: [],
  inOut: [],
  static: [],
  temp: [],
  constant: [],
});

/** Sections d'interface pertinentes selon le type de bloc (une FC n'a pas de Static). */
export function interfaceSectionsFor(blockType: BlockType): (keyof SnippetInterface)[] {
  if (blockType === "NETWORK") return [];
  if (blockType === "FC") return ["input", "output", "inOut", "temp", "constant"];
  return ["input", "output", "inOut", "static", "temp", "constant"];
}

export function emptyForm(): SnippetForm {
  return {
    id: "",
    title: "",
    summary: "",
    tagsText: "",
    blockType: "NETWORK",
    cpuFamilies: ["S7-1200", "S7-1500"],
    tiaVersion: "",
    interface: emptyInterface(),
    lad: { enabled: true, file: "main.lad", content: "" },
    scl: { enabled: true, file: "main.scl", content: "", generated: false },
    readme: "",
    createdAt: null,
  };
}

export function formFromSnippet(snippet: Snippet): SnippetForm {
  const { meta } = snippet;
  const lad = snippet.variants.find((v) => v.lang === "LAD");
  const scl = snippet.variants.find((v) => v.lang === "SCL");
  return {
    id: snippet.id,
    title: meta.title,
    summary: meta.summary,
    tagsText: meta.tags.join(", "),
    blockType: meta.blockType,
    cpuFamilies: [...meta.cpuFamilies],
    tiaVersion: meta.tiaVersion ?? "",
    interface: structuredClone(meta.interface),
    lad: { enabled: !!lad, file: lad?.file ?? "main.lad", content: lad?.content ?? "" },
    scl: {
      enabled: !!scl,
      file: scl?.file ?? "main.scl",
      content: scl?.content ?? "",
      generated: scl?.generated ?? false,
    },
    readme: snippet.readme ?? "",
    createdAt: meta.createdAt,
  };
}

export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

/** Identifiant proposé à partir du titre (modifiable tant que le snippet n'est pas créé). */
export const suggestId = (title: string) => slugify(title);

export type FormResult = { ok: true; raw: RawSnippet } | { ok: false; errors: string[] };

export type GeneratedScl = { ok: true; scl: string } | { ok: false; error: string };

/** SCL calculé depuis le LADDER (utilisé pour l'aperçu et à l'enregistrement). */
export function generateScl(ladSource: string): GeneratedScl {
  const parsed = parseLadder(ladSource);
  if (!parsed.ok) return { ok: false, error: `LADDER, ${formatLadError(parsed.error)}` };
  return { ok: true, scl: ladderToScl(parsed.program) };
}

/** Le SCL n'est généré que si le LADDER est actif ; sinon on garde le SCL écrit à la main. */
export const isSclGenerated = (form: SnippetForm) => form.lad.enabled && form.scl.generated;

/** Valide le formulaire et produit ce qui sera écrit sur le disque. */
export function formToRaw(input: SnippetForm, now = new Date().toISOString()): FormResult {
  const errors: string[] = [];
  let form = input;

  // Un LADDER invalide n'est jamais enregistré : le schéma ne pourrait pas être dessiné.
  if (form.lad.enabled && form.lad.content.trim()) {
    const parsed = parseLadder(form.lad.content);
    if (!parsed.ok) errors.push(`LADDER, ${formatLadError(parsed.error)}`);
    else if (isSclGenerated(form)) {
      form = { ...form, scl: { ...form.scl, enabled: true, content: ladderToScl(parsed.program) } };
    }
  }
  if (!form.lad.enabled && form.scl.generated) form = { ...form, scl: { ...form.scl, generated: false } };
  if (!form.title.trim()) errors.push("Le titre est obligatoire.");
  if (!ID_PATTERN.test(form.id)) {
    errors.push("Identifiant invalide : minuscules, chiffres, « - » et « _ » uniquement (ex. tempo-defaut).");
  }

  const variants = [form.lad, form.scl].filter((v) => v.enabled);
  if (variants.length === 0) errors.push("Active au moins une variante (LADDER ou SCL).");
  for (const [label, v] of [
    ["LADDER", form.lad],
    ["SCL", form.scl],
  ] as const) {
    if (v.enabled && !v.content.trim())
      errors.push(`Le code ${label} est vide (désactive la variante si besoin).`);
  }

  // Les lignes d'interface sans nom sont ignorées ; celles hors du type de bloc aussi.
  const sections = interfaceSectionsFor(form.blockType);
  const iface = emptyInterface();
  for (const key of sections) {
    iface[key] = form.interface[key]
      .filter((v) => v.name.trim())
      .map((v) => ({
        name: v.name.trim(),
        type: v.type.trim(),
        ...(v.initial?.trim() ? { initial: v.initial.trim() } : {}),
        ...(v.comment?.trim() ? { comment: v.comment.trim() } : {}),
      }));
    for (const v of iface[key]) {
      if (!v.type) errors.push(`La variable « ${v.name} » n'a pas de type.`);
    }
  }
  const names = sections.flatMap((k) => iface[k].map((v) => v.name.toLowerCase()));
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) errors.push(`La variable « ${duplicate} » est déclarée deux fois (le SCL ignore la casse).`);

  if (errors.length > 0) return { ok: false, errors };

  const meta: SnippetMetaInput = {
    schemaVersion: 1,
    title: form.title.trim(),
    summary: form.summary.trim(),
    tags: parseTags(form.tagsText),
    blockType: form.blockType,
    cpuFamilies: form.cpuFamilies,
    ...(form.tiaVersion.trim() ? { tiaVersion: form.tiaVersion.trim() } : {}),
    interface: iface,
    variants: [
      ...(form.lad.enabled ? [{ lang: "LAD" as const, file: form.lad.file }] : []),
      ...(form.scl.enabled
        ? [{ lang: "SCL" as const, file: form.scl.file, generated: form.scl.generated }]
        : []),
    ],
    createdAt: form.createdAt ?? now,
    updatedAt: now,
  };

  // Dernier filet de sécurité : le même schéma que celui utilisé à la lecture.
  const check = snippetMetaSchema.safeParse(meta);
  if (!check.success) return { ok: false, errors: check.error.issues.map((i) => i.message) };

  const withNewline = (s: string) => (s.endsWith("\n") ? s : `${s}\n`);
  const files: Record<string, string> = {};
  for (const v of variants) files[v.file] = withNewline(v.content);

  return {
    ok: true,
    raw: toRawSnippet({
      id: form.id,
      meta,
      readme: form.readme.trim() ? withNewline(form.readme) : null,
      files,
    }),
  };
}
