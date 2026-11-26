import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { CodeBlock } from "../../components/CodeBlock";
import { emptyHistory, type History, record, redo, undo } from "../../core/history";
import { checkLadderSource, errorsOf, warningsOf } from "../../core/ladder/check";
import type { ElementRef } from "../../core/ladder/edit";
import { parseLadder } from "../../core/ladder/parse";
import {
  generateScl,
  generateStl,
  isSclGenerated,
  isStlGenerated,
  type SnippetForm,
  stlContextOf,
  suggestId,
} from "../../core/snippet/form";
import { undeclaredGlobals } from "../../core/snippet/plc-tags";
import { BLOCK_TYPES, CPU_FAMILIES, type PlcTag } from "../../core/snippet/schema";
import { convertStl, detectMnemonic } from "../../core/stl/mnemonics";
import { DiagnosticsPanel } from "../ladder/Diagnostics";
import { LadderPreview } from "../ladder/LadderPreview";
import { VisualEditor } from "../ladder/VisualEditor";
import { useShortcut } from "../shortcuts";
import { MnemonicSwitch } from "../snippet/StlView";
import { CodeEditor } from "./CodeEditor";
import { InterfaceEditor } from "./InterfaceEditor";
import { PlcTagsEditor } from "./PlcTagsEditor";
import { useLeaveGuard } from "./useLeaveGuard";

const field =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none";
const label = "mb-1 block text-xs font-medium text-slate-400";

const LAD_PLACEHOLDER =
  'network "Titre du réseau"\n  ( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" -> COIL "KM1"';
const STL_PLACEHOLDER = 'U(\nO     "BP_Marche"\nO     "KM1"\n)\nU     "BP_Arret"\n=     "KM1"';
const SCL_PLACEHOLDER = '"KM1" := ("BP_Marche" OR "KM1") AND "BP_Arret";';

type LeftTab = "LAD" | "SCL" | "STL";
type RightTab = "element" | "interface" | "tags" | "problems";

/**
 * Éditeur d'un snippet, en deux zones :
 * - à gauche le programme (onglets LADDER / SCL / LIST) ;
 * - à droite un panneau contextuel : élément sélectionné, interface, variables API, problèmes.
 * La barre du haut (titre, Infos, problèmes, Enregistrer) reste visible au défilement.
 */
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
  const [infosOpen, setInfosOpen] = useState(mode === "create");
  const [left, setLeft] = useState<LeftTab>(
    initial.lad.enabled || mode === "create" ? "LAD" : initial.scl.enabled ? "SCL" : "STL",
  );
  const [right, setRight] = useState<RightTab>("element");
  const [elementPanel, setElementPanel] = useState<HTMLDivElement | null>(null);
  const [selectRequest, setSelectRequest] = useState<{ ref: ElementRef; nonce: number } | null>(null);

  const sclGenerated = isSclGenerated(form);
  const generated = sclGenerated ? generateScl(form.lad.content) : null;
  const stlGenerated = isStlGenerated(form);
  const generatedStl = stlGenerated ? generateStl(form.lad.content, stlContextOf(form)) : null;
  // Contrôles LADDER avant export TIA (type de bloc + interface + variables API).
  const checkContext = useMemo(
    () => ({ blockType: form.blockType, iface: form.interface, plcTags: form.plcTags }),
    [form.blockType, form.interface, form.plcTags],
  );
  const diagnostics = useMemo(
    () =>
      form.lad.enabled && form.lad.content.trim() ? checkLadderSource(form.lad.content, checkContext) : [],
    [form.lad.enabled, form.lad.content, checkContext],
  );
  const errorCount = errorsOf(diagnostics).length;
  const warningCount = warningsOf(diagnostics).length;
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
  const declareAll = () =>
    set("plcTags", [...form.plcTags, ...undeclared.map((g) => ({ name: g.name, type: g.type }))]);
  const variableCount = Object.values(form.interface).reduce((n, rows) => n + rows.length, 0);

  // Modifications non enregistrées : confirmation avant de quitter l'éditeur ou de fermer l'app.
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const { allowLeave } = useLeaveGuard(dirty, errors.length > 0);
  const save = () => {
    if (saving) return;
    allowLeave();
    onSave(form);
  };
  useShortcut("save", save);

  // Annuler / rétablir sur le LADDER (le mode texte garde aussi l'annulation de l'éditeur de code).
  const [ladHistory, setLadHistory] = useState<History<string>>(emptyHistory);
  const changeLad = (content: string, group: "texte" | null) => {
    if (content === form.lad.content) return;
    setLadHistory((h) => record(h, form.lad.content, group));
    set("lad", { ...form.lad, content });
  };
  const stepLad = (step: typeof undo) => {
    const result = step(ladHistory, form.lad.content);
    if (!result) return;
    setLadHistory(result.history);
    set("lad", { ...form.lad, content: result.value });
  };
  useShortcut("undo", () => stepLad(undo));
  useShortcut("redo", () => stepLad(redo));

  const showProblem = (ref: ElementRef | undefined) => {
    if (!ref) return;
    setLeft("LAD");
    setLadMode("visual");
    setRight("element");
    setSelectRequest({ ref, nonce: Date.now() });
  };

  return (
    <form
      className="flex min-h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {/* Barre fixe : titre, infos, état des contrôles, enregistrement */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-5 backdrop-blur">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-400">
            {mode === "create" ? "Nouveau snippet" : "Modifier"}
            {dirty && <span className="ml-2 text-amber-300">● non enregistré</span>}
          </p>
          <p className="truncate font-semibold text-slate-100">{form.title.trim() || "Sans titre"}</p>
        </div>
        <div className="hidden shrink-0 gap-1 xl:flex">
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
            {form.blockType}
          </span>
          {form.cpuFamilies.map((c) => (
            <span key={c} className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
              {c}
            </span>
          ))}
        </div>
        <button
          type="button"
          aria-expanded={infosOpen}
          onClick={() => setInfosOpen(!infosOpen)}
          className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-sm text-slate-300 hover:bg-slate-800"
        >
          Infos {infosOpen ? "▴" : "▾"}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {form.lad.enabled && form.lad.content.trim() && (
            <button
              type="button"
              onClick={() => setRight("problems")}
              title="Voir les problèmes détectés"
              className={`rounded-md border px-2.5 py-1 text-sm ${
                errorCount > 0
                  ? "border-red-900 bg-red-950/50 text-red-300"
                  : warningCount > 0
                    ? "border-amber-900 bg-amber-950/40 text-amber-300"
                    : "border-emerald-900 bg-emerald-950/40 text-emerald-300"
              }`}
            >
              {errorCount > 0 && `⛔ ${errorCount} erreur${errorCount > 1 ? "s" : ""}`}
              {errorCount > 0 && warningCount > 0 && " · "}
              {warningCount > 0 && `⚠ ${warningCount}`}
              {errorCount === 0 && warningCount === 0 && "✓ Prêt pour TIA"}
            </button>
          )}
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
            title="Enregistrer (Ctrl+S)"
            className="flex items-center gap-2 rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
            <kbd className="rounded bg-white/20 px-1.5 font-mono text-[11px]">Ctrl+S</kbd>
          </button>
        </div>
      </header>

      {infosOpen && (
        <section
          aria-label="Infos du snippet"
          className="grid grid-cols-4 gap-4 border-b border-slate-800 bg-slate-900/60 px-5 py-4"
        >
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
          <div className="col-span-2">
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
          <div className="col-span-4">
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
          <div>
            <span className={label}>CPU</span>
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
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
          <div>
            <label className={label} htmlFor="tia">
              Version TIA
            </label>
            <input
              id="tia"
              className={`${field} w-24`}
              value={form.tiaVersion}
              placeholder="V20"
              onChange={(e) => set("tiaVersion", e.target.value)}
            />
          </div>
          <details className="text-xs text-slate-400" open={mode === "create" && idTouched}>
            <summary className="cursor-pointer pt-6">Avancé</summary>
            <label className={`${label} mt-2`} htmlFor="id">
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
          </details>
          <div className="col-span-4">
            <span className={label}>Notes (Markdown)</span>
            <CodeEditor
              language="markdown"
              value={form.readme}
              onChange={(v) => set("readme", v)}
              minHeight="80px"
              placeholder="Câblage, précautions, cas d'usage…"
            />
          </div>
        </section>
      )}

      {errors.length > 0 && (
        <ul className="mx-5 mt-4 list-disc space-y-1 rounded-lg border border-red-900 bg-red-950/50 py-3 pr-3 pl-8 text-sm text-red-200">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-1 flex-wrap items-start gap-5 p-5">
        {/* Programme */}
        <div className="min-w-0 flex-[999_1_560px] space-y-3">
          <div
            role="tablist"
            aria-label="Programme"
            className="flex items-center gap-1 border-b border-slate-800"
          >
            {(
              [
                ["LAD", "LADDER", form.lad.enabled, false],
                ["SCL", "SCL", form.scl.enabled || sclGenerated, sclGenerated],
                ["STL", "LIST", form.stl.enabled || stlGenerated, stlGenerated],
              ] as const
            ).map(([id, name, enabled, gen]) => (
              <Tab key={id} active={left === id} onClick={() => setLeft(id)}>
                {name}
                {gen ? (
                  <span className="ml-1.5 text-[11px] text-slate-400">généré</span>
                ) : (
                  !enabled && <span className="ml-1.5 text-[11px] text-slate-500">inactif</span>
                )}
              </Tab>
            ))}
          </div>

          {left === "LAD" && (
            <>
              <OptionsBar>
                <Toggle
                  checked={form.lad.enabled}
                  onChange={(enabled) => set("lad", { ...form.lad, enabled })}
                  label="Variante LADDER"
                />
                {form.lad.enabled && (
                  <div className="inline-flex overflow-hidden rounded-md border border-slate-700 text-xs">
                    {(
                      [
                        ["visual", "Visuel"],
                        ["text", "Texte"],
                      ] as const
                    ).map(([m, name]) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setLadMode(m)}
                        className={`px-3 py-1 ${ladMode === m ? "bg-emerald-900 text-emerald-100" : "text-slate-400 hover:bg-slate-800"}`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
                {form.lad.enabled && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => stepLad(undo)}
                      disabled={ladHistory.past.length === 0}
                      title="Annuler (Ctrl+Z)"
                      className="rounded-md border border-slate-700 px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                    >
                      ↶ Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => stepLad(redo)}
                      disabled={ladHistory.future.length === 0}
                      title="Rétablir (Ctrl+Y)"
                      className="rounded-md border border-slate-700 px-2 py-0.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                    >
                      ↷ Rétablir
                    </button>
                  </div>
                )}
                <span className="text-xs text-slate-400">
                  {ladMode === "visual"
                    ? "Glisse les symboles dans le réseau."
                    : "& = série (ET), | = parallèle (OU), -> bobine. Voir docs/ladder-dsl.md"}
                </span>
              </OptionsBar>
              {form.lad.enabled &&
                (ladMode === "visual" ? (
                  <VisualEditor
                    source={form.lad.content}
                    onChange={(content) => changeLad(content, null)}
                    check={checkContext}
                    tags={tagsBinding}
                    panel={elementPanel}
                    hideDiagnostics
                    onSelectionChange={() => setRight("element")}
                    selectRequest={selectRequest}
                    stickyClass="top-16"
                  />
                ) : (
                  <div className="space-y-3">
                    <CodeEditor
                      language="lad"
                      value={form.lad.content}
                      onChange={(content) => changeLad(content, "texte")}
                      minHeight="90px"
                      placeholder={LAD_PLACEHOLDER}
                    />
                    <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60">
                      <LadderPreview source={form.lad.content} />
                    </div>
                  </div>
                ))}
            </>
          )}

          {left === "SCL" && (
            <>
              <OptionsBar>
                <Toggle
                  checked={form.scl.enabled || sclGenerated}
                  disabled={sclGenerated}
                  onChange={(enabled) => set("scl", { ...form.scl, enabled })}
                  label="Variante SCL"
                />
                {form.lad.enabled && (
                  <Toggle
                    checked={form.scl.generated}
                    onChange={(g) => set("scl", { ...form.scl, enabled: true, generated: g })}
                    label="Généré depuis le LADDER"
                  />
                )}
                <span className="text-xs text-slate-400">
                  {sclGenerated
                    ? "Décoche la génération pour l'écrire à la main."
                    : "Le corps du bloc uniquement : l'interface est dans le panneau de droite."}
                </span>
              </OptionsBar>
              {generated ? (
                generated.ok ? (
                  <CodeBlock code={generated.scl} title={`${form.scl.file} (généré)`} language="scl" />
                ) : (
                  <Warning>{generated.error}</Warning>
                )
              ) : (
                form.scl.enabled && (
                  <CodeEditor
                    language="scl"
                    value={form.scl.content}
                    onChange={(content) => set("scl", { ...form.scl, content })}
                    minHeight="260px"
                    placeholder={SCL_PLACEHOLDER}
                  />
                )
              )}
            </>
          )}

          {left === "STL" && (
            <>
              <OptionsBar>
                <Toggle
                  checked={form.stl.enabled || stlGenerated}
                  disabled={stlGenerated}
                  onChange={(enabled) => set("stl", { ...form.stl, enabled })}
                  label="Variante LIST"
                />
                {form.lad.enabled && (
                  <Toggle
                    checked={form.stl.generated}
                    onChange={(g) => set("stl", { ...form.stl, enabled: true, generated: g })}
                    label="Généré depuis le LADDER"
                  />
                )}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-slate-400">Mnémonique</span>
                  <MnemonicSwitch
                    value={form.stl.mnemonic}
                    onChange={(mnemonic) =>
                      set("stl", {
                        ...form.stl,
                        mnemonic,
                        // Le LIST généré est recalculé dans la nouvelle mnémonique : rien à convertir.
                        content: stlGenerated
                          ? form.stl.content
                          : convertStl(form.stl.content, form.stl.mnemonic, mnemonic),
                      })
                    }
                  />
                </div>
              </OptionsBar>
              <p className="text-xs text-slate-400">
                LIST = STL / AWL : S7-300/400 et S7-1500 (pas de LIST sur S7-1200).
              </p>
              {generatedStl ? (
                generatedStl.ok ? (
                  <>
                    <CodeBlock code={generatedStl.stl} title={`${form.stl.file} (généré)`} language="stl" />
                    {generatedStl.warnings.length > 0 && (
                      <ul className="space-y-0.5 rounded-lg border border-amber-900 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
                        {generatedStl.warnings.map((w) => (
                          <li key={w}>⚠ {w}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <Warning>{generatedStl.error}</Warning>
                )
              ) : (
                form.stl.enabled && (
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
                    minHeight="200px"
                    placeholder={STL_PLACEHOLDER}
                  />
                )
              )}
            </>
          )}
        </div>

        {/* Panneau contextuel */}
        <aside
          aria-label="Panneau contextuel"
          className="sticky top-[4.5rem] flex max-h-[calc(100vh-6rem)] min-w-0 flex-[1_1_360px] flex-col rounded-xl border border-slate-800 bg-slate-900 xl:max-w-[440px]"
        >
          <div role="tablist" aria-label="Panneau" className="flex shrink-0 border-b border-slate-800">
            <PanelTab active={right === "element"} onClick={() => setRight("element")}>
              Élément
            </PanelTab>
            <PanelTab
              active={right === "interface"}
              onClick={() => setRight("interface")}
              count={variableCount}
            >
              Interface
            </PanelTab>
            <PanelTab
              active={right === "tags"}
              onClick={() => setRight("tags")}
              count={undeclared.length || form.plcTags.length}
              tone={undeclared.length > 0 ? "warning" : "neutral"}
            >
              Variables API
            </PanelTab>
            <PanelTab
              active={right === "problems"}
              onClick={() => setRight("problems")}
              count={errorCount + warningCount}
              tone={errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "neutral"}
            >
              Problèmes
            </PanelTab>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {/* Toujours monté : l'éditeur visuel y affiche les propriétés de la sélection. */}
            <div ref={setElementPanel} className={right === "element" ? "space-y-2" : "hidden"} />
            {right === "element" && !(left === "LAD" && form.lad.enabled && ladMode === "visual") && (
              <p className="text-xs text-slate-400">
                Sélectionne un élément dans le schéma (onglet LADDER, mode Visuel) pour voir ses propriétés.
              </p>
            )}
            {right === "interface" && (
              <InterfaceEditor
                blockType={form.blockType}
                value={form.interface}
                onChange={(v) => set("interface", v)}
                compact
              />
            )}
            {right === "tags" && (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">
                  Variables globales du snippet, exportables en .xlsx pour TIA (Variables API → Importer).
                </p>
                <PlcTagsEditor
                  value={form.plcTags}
                  onChange={(v) => set("plcTags", v)}
                  undeclared={undeclared}
                  compact
                />
              </div>
            )}
            {right === "problems" &&
              (form.lad.enabled && form.lad.content.trim() ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">
                    Un clic sélectionne l'élément en cause dans le schéma.
                  </p>
                  <DiagnosticsPanel
                    diagnostics={diagnostics}
                    onPick={(d) => showProblem(d.ref)}
                    onFix={() => {
                      declareAll();
                      setRight("tags");
                    }}
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  Les contrôles portent sur le LADDER : il est vide ou inactif.
                </p>
              ))}
          </div>
        </aside>
      </div>
    </form>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm ${active ? "border-sky-400 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"}`}
    >
      {children}
    </button>
  );
}

const TONES = {
  neutral: "bg-slate-800 text-slate-300",
  warning: "bg-amber-950 text-amber-300",
  error: "bg-red-950 text-red-300",
};

function PanelTab({
  active,
  onClick,
  count,
  tone = "neutral",
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex flex-1 items-center justify-center gap-1 whitespace-nowrap border-b-2 px-1.5 py-2.5 text-xs ${active ? "border-sky-400 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"}`}
    >
      {children}
      {count ? <span className={`rounded-full px-1.5 text-[11px] ${TONES[tone]}`}>{count}</span> : null}
    </button>
  );
}

function OptionsBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label: text,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? "text-slate-500" : "text-slate-200"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {text}
    </label>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-900 bg-amber-950/40 p-3 font-mono text-sm text-amber-300">
      {children}
    </p>
  );
}
