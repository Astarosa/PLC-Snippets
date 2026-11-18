import type { ReactNode } from "react";
import { useState } from "react";
import { type SnippetForm, suggestId } from "../../core/snippet/form";
import { BLOCK_TYPES, CPU_FAMILIES } from "../../core/snippet/schema";
import { CodeEditor } from "./CodeEditor";
import { InterfaceEditor } from "./InterfaceEditor";

const field =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none";
const label = "mb-1 block text-xs font-medium text-slate-400";

const LAD_PLACEHOLDER =
  'network "Titre du réseau"\n  ( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" -> COIL "KM1"';
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
        hint="Écrit dans le DSL texte : & = série, | = parallèle. Le rendu graphique viendra à l'étape 4."
        enabled={form.lad.enabled}
        onToggle={(enabled) => set("lad", { ...form.lad, enabled })}
      >
        <CodeEditor
          language="lad"
          value={form.lad.content}
          onChange={(content) => set("lad", { ...form.lad, content })}
          minHeight="100px"
          placeholder={LAD_PLACEHOLDER}
        />
      </VariantSection>

      <VariantSection
        title="SCL"
        hint="Le corps du bloc uniquement : l'interface se déclare plus bas."
        enabled={form.scl.enabled}
        onToggle={(enabled) => set("scl", { ...form.scl, enabled })}
      >
        <CodeEditor
          language="scl"
          value={form.scl.content}
          onChange={(content) => set("scl", { ...form.scl, content })}
          minHeight="220px"
          placeholder={SCL_PLACEHOLDER}
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
  onToggle,
  children,
}: {
  title: string;
  hint: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">{title}</span>
        <span className="text-xs text-slate-500">{hint}</span>
      </label>
      {enabled && children}
    </section>
  );
}
