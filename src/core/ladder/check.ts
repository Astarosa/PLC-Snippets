import {
  AUTO_M_START,
  addressProblem,
  findTag,
  overlappingTags,
  undeclaredGlobals,
} from "../snippet/plc-tags";
import type { BlockType, PlcTag, Snippet, SnippetInterface, Variable } from "../snippet/schema";
import { BOX_SPECS, type BoxKind, type Expr, type LadProgram, type Operand, type Value } from "./ast";
import type { ElementRef } from "./edit";
import { normalizeProgram } from "./edit";
import { parseLadder } from "./parse";

/*
 * Vérification d'un programme LADDER avant export vers TIA Portal.
 *
 * - « error »   : TIA refusera l'import ou la compilation (opérande à compléter, variable
 *                 locale non déclarée, instance invalide, type incompatible…). L'export est bloqué.
 * - « warning » : importable, mais la logique est probablement fausse (double affectation,
 *                 Set sans Reset, front sur une variable temporaire…). L'export reste possible.
 *
 * Les types ne sont connus que pour les variables locales déclarées dans l'interface :
 * les variables API globales ne sont pas vérifiées (elles vivent dans le projet TIA).
 */

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** Réseau concerné (index 0), absent pour un problème d'interface. */
  network?: number;
  rung?: number;
  /** Élément concerné, adressé comme dans l'éditeur visuel (programme normalisé). */
  ref?: ElementRef;
  /** Problème hors réseau : interface du bloc ou table des variables API. */
  scope?: "interface" | "tags";
  /** Correction proposée par l'interface (bouton). */
  fix?: "declare-tags";
}

export interface CheckContext {
  blockType: BlockType;
  iface: SnippetInterface;
  /** Table des variables API : si fournie, les variables globales sont vérifiées avec. */
  plcTags?: PlcTag[];
}

type Section = keyof SnippetInterface;
interface Declared {
  section: Section;
  variable: Variable;
}

/* ---------- Types ---------- */

type Category = "bool" | "int" | "real" | "time" | "other";

const cleanType = (t: string) => t.trim().replace(/^"|"$/g, "").toLowerCase();

function categoryOfType(type: string): Category {
  const t = cleanType(type);
  if (t === "bool") return "bool";
  if (/^(s5time|time|ltime)$/.test(t)) return "time";
  if (/^(real|lreal)$/.test(t)) return "real";
  if (/^(u?s?int|u?d?int|u?lint|byte|d?word|lword)$/.test(t)) return "int";
  return "other";
}

function categoryOfLiteral(text: string): Category {
  const t = text.toUpperCase();
  if (/^L?T#|^TIME#|^LTIME#|^S5T#/.test(t)) return "time";
  if (t === "TRUE" || t === "FALSE" || /^BOOL#/.test(t)) return "bool";
  if (/^(16|8|2)#/.test(t) || /^[A-Z]*INT#|^(BYTE|D?WORD|LWORD)#/.test(t)) return "int";
  if (/^[+-]?\d+$/.test(t)) return "int";
  if (/^[+-]?\d+(\.\d+)?(E[+-]?\d+)?$/.test(t) || /^L?REAL#/.test(t)) return "real";
  return "other";
}

const CATEGORY_LABEL: Record<Category, string> = {
  bool: "Bool",
  int: "entier",
  real: "réel",
  time: "durée (Time)",
  other: "autre",
};

/** Types d'instance acceptés par TIA pour chaque boîte à instance. */
const INSTANCE_TYPES: Partial<Record<BoxKind, RegExp>> = {
  TON: /^(ton_l?time|iec_l?timer)$/,
  TOF: /^(tof_l?time|iec_l?timer)$/,
  TP: /^(tp_l?time|iec_l?timer)$/,
  TONR: /^(tonr_l?time|iec_l?timer)$/,
  CTU: /^(ctu_\w+|iec_\w*counter)$/,
  CTD: /^(ctd_\w+|iec_\w*counter)$/,
  CTUD: /^(ctud_\w+|iec_\w*counter)$/,
};

/** Catégorie attendue sur une broche d'entrée (null = libre). */
function expectedInput(box: BoxKind, pin: string): Category | "number" | null {
  if (pin === "PT") return "time";
  if (pin === "PV") return "int";
  if (["R", "LD", "CD"].includes(pin)) return "bool";
  if (pin === "IN1" || pin === "IN2") return "number";
  if (box === "MOVE") return null;
  return null;
}

function expectedOutput(pin: string): Category | "number" | null {
  if (pin === "ET") return "time";
  if (pin === "CV") return "int";
  if (["Q", "QU", "QD"].includes(pin)) return "bool";
  if (pin === "OUT") return "number";
  return null;
}

/* ---------- Opérandes ---------- */

const isPlaceholder = (text: string) => text.includes("???");

/** Nom racine : « "DB".a.b » → DB, « #x.y » → x. */
function rootName(op: Operand): string {
  if (op.kind === "global") return /^"([^"]*)"/.exec(op.text)?.[1] ?? op.text;
  if (op.kind === "local") return /^#([A-Za-z_]\w*)/.exec(op.text)?.[1] ?? op.text;
  return op.text;
}

/** true si l'opérande accède à un membre (« "DB".x », « #inst.Q »). */
function hasMember(op: Operand): boolean {
  if (op.kind === "global") return op.text.replace(/^"[^"]*"/, "").length > 0;
  if (op.kind === "local") return op.text.replace(/^#[A-Za-z_]\w*/, "").length > 0;
  return false;
}

const show = (v: Value) => v.text;
const key = (v: Value) => v.text.toLowerCase();

/* ---------- Vérification ---------- */

interface Write {
  kind: "assign" | "set" | "reset";
  ref: ElementRef;
  network: number;
  rung: number;
}

export function checkLadder(program: LadProgram, ctx: CheckContext): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const declared = new Map<string, Declared>();

  /* --- Interface --- */
  const seen = new Map<string, Section>();
  for (const section of Object.keys(ctx.iface) as Section[]) {
    for (const variable of ctx.iface[section]) {
      const lower = variable.name.toLowerCase();
      const other = seen.get(lower);
      if (other)
        diags.push({
          scope: "interface",
          severity: "error",
          message: `Interface : « ${variable.name} » est déclarée deux fois (${other} et ${section}).`,
        });
      else seen.set(lower, section);
      declared.set(lower, { section, variable });
      if (section === "constant" && !variable.initial)
        diags.push({
          scope: "interface",
          severity: "error",
          message: `Interface : la constante « ${variable.name} » n'a pas de valeur.`,
        });
      if (!/^[A-Za-z_]\w*$/.test(variable.name))
        diags.push({
          scope: "interface",
          severity: "warning",
          message: `Interface : « ${variable.name} » contient des espaces ou caractères spéciaux, on ne peut pas l'utiliser en #locale dans le LADDER.`,
        });
    }
  }

  if (program.networks.length === 0) {
    diags.push({ severity: "warning", message: "Le LADDER ne contient aucun réseau." });
    return diags;
  }

  const writes = new Map<string, { label: string; list: Write[] }>();
  const instances = new Map<string, { label: string; boxes: { box: BoxKind; ref: ElementRef }[] }>();
  /** Variables API globales utilisées telles quelles (sans membre) : bit, mot… */
  const plainGlobals = new Map<string, { label: string; ref: ElementRef; network: number; rung: number }>();
  const edgeMemories = new Map<string, { label: string; refs: ElementRef[] }>();
  const writtenLocals = new Set<string>();

  program.networks.forEach((network, n) => {
    network.rungs.forEach((rung, r) => {
      const where = { network: n, rung: r };
      const at = (ref: ElementRef, severity: Severity, message: string) =>
        diags.push({ severity, message, ref, ...where });

      /** Contrôles communs à tout opérande (lecture ou écriture). */
      const operand = (
        v: Value,
        ref: ElementRef,
        what: string,
        mode: "read" | "write",
        expected: Category | "number" | null,
      ) => {
        if (v.kind === "literal") {
          if (mode === "write")
            at(ref, "error", `${what} : impossible d'écrire dans une constante (${v.text}).`);
          else checkCategory(categoryOfLiteral(v.text), expected, ref, `${what} (${v.text})`);
          return;
        }
        if (isPlaceholder(v.text)) {
          at(ref, "error", `${what} : opérande à compléter (${show(v)}).`);
          return;
        }
        if (v.kind === "global" && !hasMember(v)) {
          const k = rootName(v).toLowerCase();
          if (!plainGlobals.has(k)) plainGlobals.set(k, { label: rootName(v), ref, ...where });
          // Variable déclarée dans la table : son type est connu, on le vérifie.
          const tag = ctx.plcTags ? findTag(ctx.plcTags, rootName(v)) : undefined;
          if (tag)
            checkCategory(categoryOfType(tag.type), expected, ref, `${what} ("${tag.name}" : ${tag.type})`);
        }
        if (v.kind === "absolute" && mode === "write" && /^%I/i.test(v.text))
          at(
            ref,
            "warning",
            `${what} : écriture dans une entrée (${v.text}), elle sera écrasée au prochain cycle.`,
          );
        if (v.kind !== "local") return;

        const name = rootName(v);
        if (ctx.blockType === "NETWORK") {
          at(
            ref,
            "error",
            `${what} : #${name} est une variable locale, mais un NETWORK n'a pas d'interface.`,
          );
          return;
        }
        const decl = declared.get(name.toLowerCase());
        if (!decl) {
          at(ref, "error", `${what} : #${name} n'est pas déclarée dans l'interface.`);
          return;
        }
        if (mode === "write") {
          writtenLocals.add(name.toLowerCase());
          if (decl.section === "constant")
            at(ref, "error", `${what} : #${name} est une constante, on ne peut pas l'écrire.`);
          if (decl.section === "input")
            at(ref, "warning", `${what} : #${name} est une entrée du bloc, l'écrire ici est rarement voulu.`);
        }
        if (!hasMember(v))
          checkCategory(
            categoryOfType(decl.variable.type),
            expected,
            ref,
            `${what} (#${name} : ${decl.variable.type})`,
          );
      };

      const checkCategory = (
        actual: Category,
        expected: Category | "number" | null,
        ref: ElementRef,
        what: string,
      ) => {
        if (!expected || actual === "other") return;
        const ok =
          expected === "number"
            ? actual !== "bool"
            : actual === expected || (expected === "real" && actual === "int");
        if (!ok)
          at(
            ref,
            "error",
            `${what} : type ${CATEGORY_LABEL[actual]}, il faut ${expected === "number" ? "un nombre" : `un ${CATEGORY_LABEL[expected]}`}.`,
          );
      };

      const write = (v: Value, kind: Write["kind"], ref: ElementRef) => {
        if (v.kind === "literal" || isPlaceholder(v.text)) return;
        const entry = writes.get(key(v)) ?? { label: show(v), list: [] };
        entry.list.push({ kind, ref, ...where });
        writes.set(key(v), entry);
      };

      const visit = (e: Expr, path: number[]) => {
        const ref: ElementRef = { kind: "expr", network: n, rung: r, path };
        switch (e.type) {
          case "series":
            e.items.forEach((c, i) => {
              visit(c, [...path, i]);
            });
            return;
          case "parallel":
            e.branches.forEach((c, i) => {
              visit(c, [...path, i]);
            });
            return;
          case "contact":
            operand(e.operand, ref, `Contact ${e.kind}`, "read", "bool");
            return;
          case "edge": {
            const label = `Front ${e.kind}`;
            operand(e.operand, ref, label, "read", "bool");
            operand(e.memory, ref, `${label}, bit mémoire`, "read", "bool");
            if (isPlaceholder(e.memory.text)) return;
            if (key(e.memory) === key(e.operand))
              at(ref, "error", `${label} : le bit mémoire doit être différent de l'opérande surveillé.`);
            if (e.memory.kind === "local") {
              const decl = declared.get(rootName(e.memory).toLowerCase());
              if (decl?.section === "temp")
                at(
                  ref,
                  "warning",
                  `${label} : le bit mémoire #${rootName(e.memory)} est en Temp, il est perdu à chaque cycle et le front ne sera jamais vu.`,
                );
              if (decl?.section === "input")
                at(
                  ref,
                  "warning",
                  `${label} : le bit mémoire #${rootName(e.memory)} est une entrée, il faut une variable Static ou globale.`,
                );
            }
            const mem = edgeMemories.get(key(e.memory)) ?? { label: show(e.memory), refs: [] };
            mem.refs.push(ref);
            edgeMemories.set(key(e.memory), mem);
            return;
          }
          case "compare": {
            operand(e.left, ref, `Comparateur ${e.op}`, "read", null);
            operand(e.right, ref, `Comparateur ${e.op}`, "read", null);
            const cat = (v: Value): Category | null => {
              if (v.kind === "literal") return categoryOfLiteral(v.text);
              if (v.kind !== "local" || hasMember(v)) return null;
              const decl = declared.get(rootName(v).toLowerCase());
              return decl ? categoryOfType(decl.variable.type) : null;
            };
            const a = cat(e.left);
            const b = cat(e.right);
            const numeric = (c: Category) => c === "int" || c === "real";
            if (a && b && a !== "other" && b !== "other" && a !== b && !(numeric(a) && numeric(b)))
              at(
                ref,
                "error",
                `Comparateur : ${show(e.left)} (${CATEGORY_LABEL[a]}) et ${show(e.right)} (${CATEGORY_LABEL[b]}) ne sont pas comparables.`,
              );
            else if (a && b && a !== b && numeric(a) && numeric(b))
              at(
                ref,
                "warning",
                `Comparateur : ${show(e.left)} et ${show(e.right)} mélangent entier et réel, TIA demandera une conversion.`,
              );
            if (e.left.kind === "literal" && e.right.kind === "literal")
              at(ref, "warning", "Comparateur : deux constantes, le résultat ne change jamais.");
            if (key(e.left) === key(e.right) && e.left.kind !== "literal")
              at(ref, "warning", `Comparateur : ${show(e.left)} est comparé à lui-même.`);
            return;
          }
          case "box": {
            const spec = BOX_SPECS[e.box];
            if (spec.instance) {
              const inst = e.instance;
              if (!inst || isPlaceholder(inst.text))
                at(ref, "error", `${e.box} : nom d'instance à compléter.`);
              else if (inst.kind === "absolute")
                at(ref, "error", `${e.box} : l'instance doit être un DB ou une variable, pas ${inst.text}.`);
              else {
                if (inst.kind === "local") {
                  const name = rootName(inst);
                  const decl = declared.get(name.toLowerCase());
                  if (ctx.blockType !== "FB" && !decl)
                    at(
                      ref,
                      "error",
                      `${e.box} : multi-instance #${name} impossible dans ${ctx.blockType === "FC" ? "une FC" : "un NETWORK"}. Utilise un DB d'instance global, ou passe le bloc en FB.`,
                    );
                  else if (!decl)
                    at(
                      ref,
                      "error",
                      `${e.box} : #${name} n'est pas déclarée. Ajoute-la en Static, de type ${defaultInstanceType(e.box)}.`,
                    );
                  else if (!["static", "inOut"].includes(decl.section))
                    at(
                      ref,
                      "error",
                      `${e.box} : l'instance #${name} doit être en Static (ou InOut), pas en ${decl.section}.`,
                    );
                  else if (!hasMember(inst) && !INSTANCE_TYPES[e.box]?.test(cleanType(decl.variable.type)))
                    at(
                      ref,
                      "error",
                      `${e.box} : #${name} est de type ${decl.variable.type}, il faut ${defaultInstanceType(e.box)}.`,
                    );
                }
                const k = `${inst.kind}:${rootName(inst).toLowerCase()}${hasMember(inst) ? inst.text.toLowerCase() : ""}`;
                const entry = instances.get(k) ?? { label: show(inst), boxes: [] };
                entry.boxes.push({ box: e.box, ref });
                instances.set(k, entry);
              }
            }
            for (const pin of spec.required)
              if (!(pin in e.params)) at(ref, "error", `${e.box} : paramètre ${pin} manquant.`);
            for (const [pin, v] of Object.entries(e.params)) {
              if (spec.outputs.includes(pin)) {
                operand(v, ref, `${e.box}.${pin}`, "write", expectedOutput(pin));
                write(v, "assign", ref);
              } else operand(v, ref, `${e.box}.${pin}`, "read", expectedInput(e.box, pin));
            }
            if (e.box === "DIV" && e.params.IN2?.kind === "literal" && Number(e.params.IN2.text) === 0)
              at(ref, "error", "DIV : division par zéro (IN2 = 0).");
            return;
          }
        }
      };

      visit(rung.condition, []);

      rung.outputs.forEach((o, i) => {
        const ref: ElementRef = { kind: "output", network: n, rung: r, output: i };
        const label = { COIL: "Bobine", NCOIL: "Bobine inverse", SET: "Bobine S", RESET: "Bobine R" }[o.kind];
        operand(o.operand, ref, label, "write", "bool");
        write(o.operand, o.kind === "SET" ? "set" : o.kind === "RESET" ? "reset" : "assign", ref);
      });
      const targets = rung.outputs.map((o) => key(o.operand)).filter((k) => !k.includes("???"));
      const dup = targets.find((k, i) => targets.indexOf(k) !== i);
      if (dup)
        diags.push({
          severity: "warning",
          message: `Deux bobines du même rung écrivent ${rung.outputs.find((o) => key(o.operand) === dup)?.operand.text}.`,
          ...where,
        });
    });
  });

  /* --- Contrôles sur l'ensemble du bloc --- */

  for (const { label, list } of writes.values()) {
    const assigns = list.filter((w) => w.kind === "assign");
    const sets = list.filter((w) => w.kind === "set");
    const resets = list.filter((w) => w.kind === "reset");
    const last = list[list.length - 1];
    const loc = { ref: last.ref, network: last.network, rung: last.rung };
    if (assigns.length > 1)
      diags.push({
        severity: "warning",
        message: `${label} est affectée ${assigns.length} fois (réseaux ${networksOf(assigns)}) : seule la dernière écriture compte.`,
        ...loc,
      });
    if (assigns.length > 0 && sets.length + resets.length > 0)
      diags.push({
        severity: "warning",
        message: `${label} est à la fois pilotée par une bobine simple et par Set/Reset : la bobine simple écrase le Set/Reset.`,
        ...loc,
      });
    if (assigns.length === 0 && sets.length > 0 && resets.length === 0)
      diags.push({
        severity: "warning",
        message: `${label} est mise à 1 (S) mais jamais remise à 0 (R) dans ce bloc.`,
        ...loc,
      });
    if (assigns.length === 0 && resets.length > 0 && sets.length === 0)
      diags.push({
        severity: "warning",
        message: `${label} est remise à 0 (R) mais jamais mise à 1 (S) dans ce bloc.`,
        ...loc,
      });
  }

  for (const { label, boxes } of instances.values()) {
    const kinds = [...new Set(boxes.map((b) => b.box))];
    const last = boxes[boxes.length - 1].ref;
    const loc = { ref: last, network: last.network, rung: last.rung };
    if (kinds.length > 1)
      diags.push({
        severity: "error",
        message: `L'instance ${label} sert à des boîtes différentes (${kinds.join(", ")}).`,
        ...loc,
      });
    else if (boxes.length > 1)
      diags.push({
        severity: "warning",
        message: `L'instance ${label} est appelée ${boxes.length} fois : chaque ${kinds[0]} doit avoir sa propre instance.`,
        ...loc,
      });
  }

  // Un DB d'instance ne peut pas porter le nom d'une variable API utilisée comme bit ou mot.
  for (const [k, { label }] of instances) {
    if (!k.startsWith("global:")) continue;
    const plain = plainGlobals.get(k.slice("global:".length));
    if (plain)
      diags.push({
        severity: "error",
        message: `"${plain.label}" est utilisé à la fois comme instance (${label}) et comme variable API : un DB et une variable ne peuvent pas avoir le même nom.`,
        ref: plain.ref,
        network: plain.network,
        rung: plain.rung,
      });
  }

  for (const { label, refs } of edgeMemories.values()) {
    if (refs.length > 1)
      diags.push({
        severity: "warning",
        message: `Le bit mémoire ${label} sert à ${refs.length} fronts : chaque front a besoin de son propre bit.`,
        ref: refs[1],
        network: refs[1].network,
        rung: refs[1].rung,
      });
    if (writes.has(label.toLowerCase()))
      diags.push({
        severity: "warning",
        message: `Le bit mémoire ${label} est aussi écrit par une bobine ou une boîte : le front sera faussé.`,
        ref: refs[0],
        network: refs[0].network,
        rung: refs[0].rung,
      });
  }

  if (ctx.plcTags) diags.push(...checkTags(program, ctx.plcTags, instances));

  if (ctx.blockType !== "NETWORK")
    for (const v of ctx.iface.output)
      if (!writtenLocals.has(v.name.toLowerCase()))
        diags.push({
          scope: "interface",
          severity: "warning",
          message: `La sortie #${v.name} n'est jamais écrite dans le bloc.`,
        });

  return diags;
}

/** Contrôles de la table des variables API, et de son accord avec le LADDER. */
function checkTags(program: LadProgram, tags: PlcTag[], instances: Map<string, unknown>): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const push = (severity: Severity, message: string, fix?: Diagnostic["fix"]) =>
    diags.push({ severity, message, scope: "tags", ...(fix ? { fix } : {}) });

  const missing = undeclaredGlobals(program, tags);
  if (missing.length > 0) {
    const names = missing.slice(0, 6).map((g) => `"${g.name}"`);
    const more = missing.length > 6 ? ` et ${missing.length - 6} autres` : "";
    push(
      "warning",
      `${missing.length} variable${missing.length > 1 ? "s" : ""} API absente${missing.length > 1 ? "s" : ""} de la table : ${names.join(", ")}${more}. Sans déclaration, il faudra les créer à la main dans TIA.`,
      "declare-tags",
    );
  }

  const seen = new Set<string>();
  for (const tag of tags) {
    const k = tag.name.toLowerCase();
    if (seen.has(k)) push("error", `"${tag.name}" est déclarée deux fois.`);
    seen.add(k);
    const problem = addressProblem(tag);
    if (problem) push("error", `"${tag.name}" : ${problem}.`);
    if (instances.has(`global:${k}`))
      push(
        "error",
        `"${tag.name}" sert d'instance de temporisation ou de compteur : c'est un DB, pas une variable API. Retire-la de la table.`,
      );
  }
  for (const [a, b] of overlappingTags(tags))
    push("warning", `"${a.name}" (${a.address}) et "${b.name}" (${b.address}) se chevauchent en mémoire.`);

  const noAddress = tags.filter((t) => !t.address?.trim());
  if (noAddress.length > 0)
    push(
      "warning",
      `${noAddress.length} variable${noAddress.length > 1 ? "s" : ""} sans adresse : une adresse %M libre sera attribuée à l'export (à partir de %MB${AUTO_M_START}).`,
    );
  return diags;
}

function defaultInstanceType(box: BoxKind): string {
  if (["TON", "TOF", "TP", "TONR"].includes(box)) return `${box}_TIME`;
  return `${box}_INT`;
}

const networksOf = (list: { network: number }[]) => [...new Set(list.map((w) => w.network + 1))].join(", ");

/** Position lisible d'un diagnostic : « Réseau 2, rung 1 ». */
export function locate(d: Diagnostic): string {
  if (d.network === undefined)
    return d.scope === "tags" ? "Variables API" : d.scope === "interface" ? "Interface" : "LADDER";
  return d.rung === undefined ? `Réseau ${d.network + 1}` : `Réseau ${d.network + 1}, rung ${d.rung + 1}`;
}

export const errorsOf = (diags: Diagnostic[]) => diags.filter((d) => d.severity === "error");
export const warningsOf = (diags: Diagnostic[]) => diags.filter((d) => d.severity === "warning");

/** Vérifie le texte LADDER d'un snippet (erreur de syntaxe = un diagnostic bloquant). */
export function checkLadderSource(source: string, ctx: CheckContext): Diagnostic[] {
  if (!source.trim()) return checkLadder({ networks: [] }, ctx);
  const parsed = parseLadder(source);
  if (!parsed.ok)
    return [
      {
        severity: "error",
        message: `LADDER illisible, ligne ${parsed.error.line} : ${parsed.error.message}`,
      },
    ];
  return checkLadder(normalizeProgram(parsed.program), ctx);
}

/** Résumé court pour un message d'export : « 2 erreurs : … ». */
export function summarize(diags: Diagnostic[], max = 3): string {
  const shown = diags.slice(0, max).map((d) => `${locate(d)} : ${d.message}`);
  const more = diags.length > max ? ` (+${diags.length - max} autres)` : "";
  return `${shown.join(" ; ")}${more}`;
}

/** Diagnostics du LADDER d'un snippet ([] s'il n'a pas de LADDER). */
export function checkSnippetLadder(snippet: Snippet): Diagnostic[] {
  const lad = snippet.variants.find((v) => v.lang === "LAD");
  if (!lad) return [];
  return checkLadderSource(lad.content, {
    blockType: snippet.meta.blockType,
    iface: snippet.meta.interface,
    plcTags: snippet.meta.plcTags,
  });
}

/** Le SCL exporté vient-il du LADDER (généré, ou pas de SCL écrit à la main) ? */
export const sclComesFromLadder = (snippet: Snippet) => {
  const scl = snippet.variants.find((v) => v.lang === "SCL");
  return snippet.variants.some((v) => v.lang === "LAD") && (!scl || scl.generated);
};

/** Raison courte pour griser une entrée du menu Exporter (null = exportable). */
export function ladderRefusal(snippet: Snippet): string | null {
  const errors = errorsOf(checkSnippetLadder(snippet));
  if (errors.length === 0) return null;
  return `${errors.length} erreur${errors.length > 1 ? "s" : ""} LADDER`;
}
