import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { CodeBlock } from "../../components/CodeBlock";
import { checkLadderSource } from "../../core/ladder/check";
import { parseLadder } from "../../core/ladder/parse";
import { generateScl, isSclGenerated, type SnippetForm, suggestId } from "../../core/snippet/form";
import { undeclaredGlobals } from "../../core/snippet/plc-tags";
import { BLOCK_TYPES, CPU_FAMILIES, type PlcTag } from "../../core/snippet/schema";
import { convertStl, detectMnemonic } from "../../core/stl/mnemonics";
import { DiagnosticsPanel } from "../ladder/Diagnostics";
import { LadderPreview } from "../ladder/LadderPreview";
import { VisualEditor } from "../ladder/VisualEditor";
import { MnemonicSwitch } from "../snippet/StlView";
import { CodeEditor } from "./CodeEditor";
import { InterfaceEditor } from "./InterfaceEditor";
import { PlcTagsEditor } from "./PlcTagsEditor";

const field =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none";
const label = "mb-1 block text-xs font-medium text-slate-400";

const LAD_PLACEHOLDER =
  'network "Titre du réseau"\n  ( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" -> COIL "KM1"';
const STL_PLACEHOLDER = 'U(\nO     "BP_Marche"\nO     "KM1"\n)\nU     "BP_Arret"\n=     "KM1"';
const SCL_PLACEHOLDER = '"KM1" := ("BP_Marche" OR "KM1") AND "BP_Arret";';

export function SnippetEditor({
  initial,
  mode,
  saving,
  errors,
  onSave,
  onCancel,
}: {
  initial: SnippetForm;
  mode: "create" | "edit";
  saving: boolean;
  errors: string[];
  onSave: (form: SnippetForm) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  // En création, l'identifiant suit le titre tant qu'on ne l'a pas modifié à la main.
  const [idTouched, setIdTouched] = useState(mode === "edit");
  const [ladMode, setLadMode] = useState<"visual" | "text">("visual");
  const sclGenerated = isSclGenerated(form);
  const generated = sclGenerated ? generateScl(form.lad.content) : null;
  // Contrôles LADDER avant export TIA (type de bloc + interface déclarée).
  const checkContext = useMemo(
    () => ({ blockType: form.blockType, iface: form.interface, plcTags: form.plcTags }),
    [form.blockType, form.interface, form.plcTags],
  );
  // Variables API du LADDER pas encore dans la table (proposées à la déclaration).
  const undeclared = useMemo(() => {
    if (!form.lad.enabled || !form.lad.content.trim()) return [];
    const parsed = parseLadder(form.lad.content);
    return parsed.ok ? undeclaredGlobals(parsed.program, form.plcTags) : [];
  }, [form.lad.enabled, form.lad.content, form.plcTags]);
  const tagsBinding = useMemo(
    () => ({ value: form.plcTags, onChange: (plcTags: PlcTag[]) => setForm((f) => ({ ...f, plcTags })) }),
    [form.plcTags],
  );
  const set = <K extends keyof SnippetForm>(key: K, value: SnippetForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      className="mx-auto max-w-5xl space-y-6 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
    >
      <header className="flex items-center gap-3">
        <h2 className="text-xl font-semibold text-slate-100">
          {mode === "create" ? "Nouveau snippet" : "Modifier le snippet"}
        </h2>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </header>

      {errors.length > 0 && (
        <ul className="list-disc space-y-1 rounded-lg border border-red-900 bg-red-950/50 py-3 pr-3 pl-8 text-sm text-red-200">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <section className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className={label} htmlFor="title">
            Titre
          </label>
          <input
            id="title"
            className={field}
            value={form.title}
            placeholder="Tempo de surveillance capteur"
            onChange={(e) => {
              const title = e.target.value;
              setForm((f) => ({ ...f, title, id: idTouched ? f.id : suggestId(title) }));
            }}
          />
        </div>
        <div>
          <label className={label} htmlFor="id">
            Identifiant (nom du dossier){mode === "edit" && " — non modifiable"}
          </label>
          <input
            id="id"
            className={`${field} font-mono disabled:opacity-60`}
            value={form.id}
            disabled={mode === "edit"}
            onChange={(e) => {
              setIdTouched(true);
              set("id", e.target.value);
            }}
          />
        </div>
        <div>
          <label className={label} htmlFor="tags">
            Tags (séparés par des virgules)
          </label>
          <input
            id="tags"
            className={field}
            value={form.tagsText}
            placeholder="moteur, tempo, défaut"
            onChange={(e) => set("tagsText", e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className={label} htmlFor="summary">
            Résumé
          </label>
          <input
            id="summary"
            className={field}
            value={form.summary}
            placeholder="Une phrase : ce que fait le snippet"
            onChange={(e) => set("summary", e.target.value)}
          />
        </div>
        <div>
          <span className={label}>Type de bloc</span>
          <div className="flex gap-1">
            {BLOCK_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("blockType", t)}
                className={`rounded-md border px-3 py-1 text-sm ${
                  form.blockType === t
                    ? "border-sky-600 bg-sky-950 text-sky-200"
                    : "border-slate-700 text-slate-400 hover:text-slate-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-4">
          <div>
            <span className={label}>CPU</span>
            <div className="flex gap-3 pt-1">
              {CPU_FAMILIES.map((c) => (
                <label key={c} className="flex items-center gap-1.5 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.cpuFamilies.includes(c)}
                    onChange={(e) =>
                      set(
                        "cpuFamilies",
                        e.target.checked ? [...form.cpuFamilies, c] : form.cpuFamilies.filter((x) => x !== c),
                      )
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
          </div>
          <div className="w-24">
            <label className={label} htmlFor="tia">
              TIA
            </label>
            <input
              id="tia"
              className={field}
              value={form.tiaVersion}
              placeholder="V19"
              onChange={(e) => set("tiaVersion", e.target.value)}
            />
          </div>
        </div>
      </section>

      <VariantSection
        title="LADDER"
        hint={
          ladMode === "visual"
            ? "Glisse les symboles dans le réseau ; l'onglet Texte montre le même schéma en DSL."
            : "& = série (ET), | = parallèle (OU), -> bobine. Voir docs/ladder-dsl.md"
        }
        enabled={form.lad.enabled}
        onToggle={(enabled) => set("lad", { ...form.lad, enabled })}
      >
        <div className="flex items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-md border border-slate-700 text-xs">
            {(
              [
                ["visual", "Visuel"],
                ["text", "Texte"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setLadMode(mode)}
                className={`px-3 py-1 ${ladMode === mode ? "bg-emerald-900 text-emerald-100" : "text-slate-400 hover:bg-slate-800"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {ladMode === "visual" ? (
          <VisualEditor
            source={form.lad.content}
            onChange={(content) => set("lad", { ...form.lad, content })}
            check={checkContext}
            tags={tagsBinding}
          />
        ) : (
          <div className="space-y-3">
            <CodeEditor
              language="lad"
              value={form.lad.content}
              onChange={(content) => set("lad", { ...form.lad, content })}
              minHeight="90px"
              placeholder={LAD_PLACEHOLDER}
            />
            <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60">
              <LadderPreview source={form.lad.content} />
            </div>
            {form.lad.content.trim() && (
              <DiagnosticsPanel
                diagnostics={checkLadderSource(form.lad.content, checkContext)}
                onFix={() =>
                  set("plcTags", [
                    ...form.plcTags,
                    ...undeclared.map((g) => ({ name: g.name, type: g.type })),
                  ])
                }
              />
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={form.scl.generated}
            onChange={(e) => set("scl", { ...form.scl, enabled: true, generated: e.target.checked })}
          />
          Générer le SCL automatiquement depuis le LADDER
        </label>
      </VariantSection>

      <VariantSection
        title="SCL"
        hint={
          sclGenerated
            ? "Généré depuis le LADDER : décoche la génération pour l'écrire à la main."
            : "Le corps du bloc uniquement : l'interface se déclare plus bas."
        }
        enabled={form.scl.enabled || sclGenerated}
        locked={sclGenerated}
        onToggle={(enabled) => set("scl", { ...form.scl, enabled })}
      >
        {generated ? (
          generated.ok ? (
            <CodeBlock code={generated.scl} title={`${form.scl.file} (généré)`} language="scl" />
          ) : (
            <p className="rounded-lg border border-amber-900 bg-amber-950/40 p-3 font-mono text-sm text-amber-300">
              {generated.error}
            </p>
          )
        ) : (
          <CodeEditor
            language="scl"
            value={form.scl.content}
            onChange={(content) => set("scl", { ...form.scl, content })}
            minHeight="220px"
            placeholder={SCL_PLACEHOLDER}
          />
        )}
      </VariantSection>

      <VariantSection
        title="LIST"
        hint="STL / AWL (S7-300/400 et S7-1500, pas de LIST sur S7-1200)."
        enabled={form.stl.enabled}
        onToggle={(enabled) => set("stl", { ...form.stl, enabled })}
      >
        <div className="flex items-center gap-3">
          <MnemonicSwitch
            value={form.stl.mnemonic}
            onChange={(mnemonic) =>
              set("stl", {
                ...form.stl,
                mnemonic,
                content: convertStl(form.stl.content, form.stl.mnemonic, mnemonic),
              })
            }
          />
          <span className="text-xs text-slate-500">
            Convertit le code entre mnémoniques allemandes et anglaises.
          </span>
        </div>
        <CodeEditor
          language="stl"
          value={form.stl.content}
          onChange={(content) => {
            // Code collé dans une zone vide : on reconnaît sa mnémonique.
            const mnemonic = form.stl.content.trim()
              ? form.stl.mnemonic
              : (detectMnemonic(content) ?? form.stl.mnemonic);
            set("stl", { ...form.stl, content, mnemonic });
          }}
          minHeight="160px"
          placeholder={STL_PLACEHOLDER}
        />
      </VariantSection>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Interface</h3>
        <InterfaceEditor
          blockType={form.blockType}
          value={form.interface}
          onChange={(v) => set("interface", v)}
        />
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Variables API (table des variables TIA)
        </h3>
        <p className="mb-2 text-xs text-slate-500">
          Les variables globales du snippet, exportables en .xlsx pour les importer dans TIA (Variables API →
          Importer). Tu peux aussi les déclarer depuis le LADDER en sélectionnant un élément.
        </p>
        <PlcTagsEditor value={form.plcTags} onChange={(v) => set("plcTags", v)} undeclared={undeclared} />
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Notes (Markdown)
        </h3>
        <CodeEditor
          language="markdown"
          value={form.readme}
          onChange={(v) => set("readme", v)}
          minHeight="120px"
          placeholder="Câblage, précautions, cas d'usage…"
        />
      </section>
    </form>
  );
}

function VariantSection({
  title,
  hint,
  enabled,
  locked = false,
  onToggle,
  children,
}: {
  title: string;
  hint: string;
  enabled: boolean;
  locked?: boolean;
  onToggle: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={locked}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">{title}</span>
        <span className="text-xs text-slate-500">{hint}</span>
      </label>
      {enabled && children}
    </section>
  );
}
