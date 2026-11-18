import { DOMParser, type Element } from "@xmldom/xmldom";
import type { BoxKind, CompareOp, Expr, Operand, Output, Value } from "../../ladder/ast";
import { BOX_SPECS } from "../../ladder/ast";
import { type FlowGraph, type FlowNode, graphsToProgram } from "../../ladder/graph";
import { printLadder } from "../../ladder/print";
import { ladderToScl } from "../../ladder/scl";
import { emptyInterface } from "../../snippet/form";
import { parseRawSnippet, slugify, toRawSnippet } from "../../snippet/parse";
import type { BlockType, SnippetInterface, Variable } from "../../snippet/schema";
import type { ImportItem } from "../types";

/*
 * Lecture d'un export SimaticML (TIA Portal, Openness / VCI) d'un bloc LAD.
 *
 * Un réseau (CompileUnit) contient un FlgNet :
 *   - Access : opérandes (variable locale / globale, constante),
 *   - Part   : éléments (Contact, Coil, O, TON, Move…),
 *   - Wire   : une source (Powerrail, sortie d'un Part, IdentCon) puis N destinations.
 * On reconstruit un graphe de flux (src/core/ladder/graph.ts) puis le DSL LADDER.
 */

/* ---------- Petits outils DOM (indépendants des espaces de noms) ---------- */

const elements = (el: Element | null | undefined): Element[] =>
  el ? (Array.from(el.childNodes).filter((n) => n.nodeType === 1) as Element[]) : [];
const kids = (el: Element | null | undefined, name: string) =>
  elements(el).filter((c) => c.localName === name);
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] ?? null;
const path = (el: Element | null | undefined, ...names: string[]) =>
  names.reduce<Element | null>((cur, n) => kid(cur, n), el ?? null);
const text = (el: Element | null | undefined) => (el?.textContent ?? "").trim();

function descendants(el: Element, name: string): Element[] {
  const out: Element[] = [];
  const walk = (e: Element) => {
    for (const c of elements(e)) {
      if (c.localName === name) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

/** Texte d'un MultilingualText (Title / Comment) : la première culture non vide. */
function multilingual(objectList: Element | null, composition: string): string {
  const ml = kids(objectList, "MultilingualText").find(
    (m) => m.getAttribute("CompositionName") === composition,
  );
  for (const item of kids(kid(ml, "ObjectList"), "MultilingualTextItem")) {
    const t = text(path(item, "AttributeList", "Text"));
    if (t) return t.replace(/\r\n?/g, "\n");
  }
  return "";
}

/* ---------- Interface ---------- */

const SECTION_KEYS: Record<string, keyof SnippetInterface> = {
  Input: "input",
  Output: "output",
  InOut: "inOut",
  Static: "static",
  Temp: "temp",
  Constant: "constant",
};

function readInterface(
  attributes: Element | null,
  warnings: string[],
): { iface: SnippetInterface; ret: string | null } {
  const iface = emptyInterface();
  let ret: string | null = null;
  for (const section of kids(path(attributes, "Interface", "Sections"), "Section")) {
    const name = section.getAttribute("Name") ?? "";
    for (const member of kids(section, "Member")) {
      const memberName = member.getAttribute("Name") ?? "";
      const type = (member.getAttribute("Datatype") ?? "").replace(/^"(.*)"$/, "$1");
      if (name === "Return") {
        if (!/^void$/i.test(type)) ret = type;
        continue;
      }
      const key = SECTION_KEYS[name];
      if (!key) continue;
      const nested = kids(member, "Member").length > 0 || kid(member, "Sections") !== null;
      const comment = text(path(member, "Comment", "MultiLanguageText"));
      const start = text(kid(member, "StartValue"));
      const variable: Variable = {
        name: memberName,
        type: nested ? "Struct" : type,
        ...(start ? { initial: start } : {}),
        ...(comment ? { comment } : {}),
      };
      if (nested) warnings.push(`${memberName} : structure importée comme « Struct », à détailler à la main`);
      iface[key].push(variable);
    }
  }
  return { iface, ret };
}

/* ---------- Opérandes ---------- */

const IDENT = /^[A-Za-z_]\w*$/;
const member = (name: string) => (IDENT.test(name) ? name : `"${name}"`);

/** Access → opérande ou constante du DSL ; null si non géré (raison dans warnings). */
function readAccess(access: Element, warnings: string[]): Value | null {
  const scope = access.getAttribute("Scope") ?? "";
  const components = kids(kid(access, "Symbol"), "Component").map((c) => c.getAttribute("Name") ?? "");
  switch (scope) {
    case "LocalVariable":
    case "LocalConstant": {
      const names =
        scope === "LocalConstant"
          ? [
              kid(kid(access, "Constant"), "Constant")?.getAttribute("Name") ??
                kid(access, "Constant")?.getAttribute("Name") ??
                "",
            ]
          : components;
      const [first, ...rest] = names;
      if (!first) break;
      if (!IDENT.test(first)) {
        warnings.push(`Variable locale « ${first} » : nom avec caractères spéciaux non géré`);
        return null;
      }
      return { kind: "local", text: [`#${first}`, ...rest.map(member)].join(".") };
    }
    case "GlobalVariable": {
      const [first, ...rest] = components;
      if (!first) break;
      return { kind: "global", text: [`"${first}"`, ...rest.map(member)].join(".") };
    }
    case "LiteralConstant":
    case "TypedConstant":
    case "GlobalConstant": {
      const constant = kid(access, "Constant");
      const value = text(kid(constant, "ConstantValue")) || constant?.getAttribute("Name") || "";
      if (!value) break;
      if (scope === "GlobalConstant") return { kind: "global", text: `"${value}"` };
      return { kind: "literal", text: value.toUpperCase() };
    }
  }
  warnings.push(`Opérande de type « ${scope} » non géré`);
  return null;
}

/* ---------- Réseau (FlgNet) → graphe ---------- */

type Endpoint =
  | { kind: "rail" }
  | { kind: "ident"; uid: string }
  | { kind: "pin"; uid: string; pin: string }
  | { kind: "open" };

const COMPARE: Record<string, CompareOp> = { Eq: "==", Ne: "<>", Gt: ">", Lt: "<", Ge: ">=", Le: "<=" };
const MATH: Record<string, BoxKind> = { Move: "MOVE", Add: "ADD", Sub: "SUB", Mul: "MUL", Div: "DIV" };
const TIMERS_COUNTERS = new Set(["TON", "TOF", "TP", "TONR", "CTU", "CTD", "CTUD"]);

/** Broche d'entrée / de sortie du flux pour chaque type de Part. */
function flowPins(partName: string): { in: string[]; out: string } | null {
  if (["Contact", "PContact", "NContact", "Coil", "SCoil", "RCoil"].includes(partName))
    return { in: ["in"], out: "out" };
  if (partName in COMPARE) return { in: ["pre"], out: "out" };
  if (partName in MATH) return { in: ["en"], out: "eno" };
  if (TIMERS_COUNTERS.has(partName)) {
    const spec = BOX_SPECS[partName as BoxKind];
    return { in: [spec.mainIn], out: spec.mainOut };
  }
  return null;
}

class UnsupportedNetwork extends Error {}

function readNetwork(
  flgNet: Element,
  title: string,
  comment: string,
): { graph: FlowGraph | null; warnings: string[] } {
  const warnings: string[] = [];
  const parts = kid(flgNet, "Parts");
  const accesses = new Map<string, Value | null>();
  for (const a of kids(parts, "Access")) accesses.set(a.getAttribute("UId") ?? "", readAccess(a, warnings));
  const partEls = new Map(kids(parts, "Part").map((p) => [p.getAttribute("UId") ?? "", p]));

  // Fils : (source, destination) pour chaque destination d'un Wire.
  const links: { from: Endpoint; to: Endpoint }[] = [];
  for (const wire of kids(kid(flgNet, "Wires"), "Wire")) {
    const ends: Endpoint[] = elements(wire).map((e): Endpoint => {
      if (e.localName === "Powerrail") return { kind: "rail" };
      if (e.localName === "IdentCon") return { kind: "ident", uid: e.getAttribute("UId") ?? "" };
      if (e.localName === "NameCon")
        return { kind: "pin", uid: e.getAttribute("UId") ?? "", pin: e.getAttribute("Name") ?? "" };
      return { kind: "open" };
    });
    const [from, ...targets] = ends;
    for (const to of targets) if (from) links.push({ from, to });
  }

  /** Valeur reliée à une broche de paramètre (entrée : Access → broche ; sortie : broche → Access). */
  const pinValue = (uid: string, pin: string): Value | null | undefined => {
    for (const { from, to } of links) {
      if (to.kind === "pin" && to.uid === uid && to.pin === pin && from.kind === "ident")
        return accesses.get(from.uid);
      if (from.kind === "pin" && from.uid === uid && from.pin === pin && to.kind === "ident")
        return accesses.get(to.uid);
    }
    return undefined;
  };
  const requireOperand = (uid: string, pin: string, what: string): Operand => {
    const v = pinValue(uid, pin);
    if (!v || v.kind === "literal") throw new UnsupportedNetwork(`${what} : opérande manquant ou constant`);
    return v;
  };

  /** Sources de flux arrivant sur une broche ; un OU (Part O) est remplacé par ses propres entrées. */
  const sourcesOf = (uid: string, pin: string, seen = new Set<string>()): (string | null)[] => {
    const out: (string | null)[] = [];
    for (const { from, to } of links) {
      if (to.kind !== "pin" || to.uid !== uid || to.pin !== pin) continue;
      if (from.kind === "rail") out.push(null);
      else if (from.kind === "pin") {
        const src = partEls.get(from.uid);
        if (src?.getAttribute("Name") === "O") {
          if (seen.has(from.uid)) continue;
          seen.add(from.uid);
          const card = Number(
            text(kids(src, "TemplateValue").find((t) => t.getAttribute("Name") === "Card")) || "2",
          );
          for (let i = 1; i <= card; i++) out.push(...sourcesOf(from.uid, `in${i}`, seen));
        } else out.push(from.uid);
      }
    }
    return out;
  };

  const nodes: FlowNode[] = [];
  try {
    for (const [uid, part] of partEls) {
      const name = part.getAttribute("Name") ?? "";
      if (name === "O") continue;
      const pins = flowPins(name);
      if (!pins) throw new UnsupportedNetwork(`élément « ${name} » pas encore géré`);
      const negated = new Set(kids(part, "Negated").map((n) => n.getAttribute("Name")));
      const sources = pins.in.flatMap((p) => sourcesOf(uid, p));

      let node: FlowNode;
      if (name === "Coil" || name === "SCoil" || name === "RCoil") {
        const kind =
          name === "SCoil" ? "SET" : name === "RCoil" ? "RESET" : negated.has("operand") ? "NCOIL" : "COIL";
        node = {
          id: uid,
          kind: "coil",
          output: { kind, operand: requireOperand(uid, "operand", "Bobine") } as Output,
          sources,
        };
      } else {
        let element: Expr;
        if (name === "Contact") {
          element = {
            type: "contact",
            kind: negated.has("operand") ? "NC" : "NO",
            operand: requireOperand(uid, "operand", "Contact"),
          };
        } else if (name === "PContact" || name === "NContact") {
          element = {
            type: "edge",
            kind: name === "PContact" ? "P" : "N",
            operand: requireOperand(uid, "operand", "Front"),
            memory: requireOperand(uid, "bit", "Bit mémoire du front"),
          };
        } else if (name in COMPARE) {
          const left = pinValue(uid, "in1");
          const right = pinValue(uid, "in2");
          if (!left || !right) throw new UnsupportedNetwork("comparateur : valeur manquante");
          element = { type: "compare", op: COMPARE[name], left, right };
        } else if (name in MATH) {
          const box = MATH[name];
          const outPin = box === "MOVE" ? "out1" : "out";
          const params: Record<string, Value> = {};
          const mapping =
            box === "MOVE" ? { IN: "in", OUT: outPin } : { IN1: "in1", IN2: "in2", OUT: outPin };
          for (const [param, pin] of Object.entries(mapping)) {
            const v = pinValue(uid, pin);
            if (!v) throw new UnsupportedNetwork(`${name} : ${pin} non câblé`);
            params[param] = v;
          }
          const card = Number(
            text(kids(part, "TemplateValue").find((t) => t.getAttribute("Name") === "Card")) || "0",
          );
          if ((box === "MOVE" && card > 1) || (box !== "MOVE" && card > 2)) {
            warnings.push(`${name} à ${card} entrées / sorties : seules les premières sont reprises`);
          }
          element = { type: "box", box, instance: null, params };
        } else {
          const box = name as BoxKind;
          const spec = BOX_SPECS[box];
          const inst = kid(part, "Instance");
          const instName = kids(inst, "Component").map((c) => c.getAttribute("Name") ?? "");
          if (!inst || !instName[0]) throw new UnsupportedNetwork(`${name} : instance manquante`);
          const instance: Operand =
            inst.getAttribute("Scope") === "LocalVariable"
              ? { kind: "local", text: [`#${instName[0]}`, ...instName.slice(1).map(member)].join(".") }
              : { kind: "global", text: [`"${instName[0]}"`, ...instName.slice(1).map(member)].join(".") };
          const params: Record<string, Value> = {};
          for (const p of [...spec.inputs, ...spec.outputs]) {
            const v = pinValue(uid, p);
            if (v) params[p] = v;
          }
          for (const p of spec.required)
            if (!params[p]) throw new UnsupportedNetwork(`${name} : ${p} non câblé`);
          element = { type: "box", box, instance, params };
        }
        node = { id: uid, kind: "element", element, sources };
      }
      nodes.push(node);
    }
  } catch (e) {
    if (e instanceof UnsupportedNetwork) return { graph: null, warnings: [...warnings, e.message] };
    throw e;
  }
  return { graph: { title: title || null, ...(comment ? { comment } : {}), nodes }, warnings };
}

/* ---------- Document complet ---------- */

const BLOCK_TAGS: Record<string, BlockType | "OB"> = {
  "SW.Blocks.FB": "FB",
  "SW.Blocks.FC": "FC",
  "SW.Blocks.OB": "OB",
};

export function isSimaticMl(content: string): boolean {
  return /<Document[\s>]/.test(content) && /<SW\.Blocks\./.test(content);
}

export function readSimaticMl(content: string, origin: string): ImportItem {
  const fail = (errors: string[], warnings: string[] = []): ImportItem => ({
    origin,
    id: slugify(origin.replace(/\.xml$/i, "")) || "bloc-simaticml",
    snippet: null,
    errors,
    warnings,
  });

  let doc: ReturnType<DOMParser["parseFromString"]>;
  try {
    doc = new DOMParser({ onError: () => {} }).parseFromString(content, "text/xml");
  } catch (e) {
    return fail([`XML illisible : ${(e as Error).message}`]);
  }
  const root = doc.documentElement;
  if (root?.localName !== "Document") return fail(["Pas un document SimaticML (élément <Document> attendu)"]);

  const blockEl = elements(root).find((e) => (e.localName ?? "").startsWith("SW.Blocks."));
  if (!blockEl) return fail(["Aucun bloc dans ce fichier SimaticML"]);
  const tag = blockEl.localName ?? "";
  if (!(tag in BLOCK_TAGS))
    return fail([`${tag.replace("SW.Blocks.", "")} : seuls les FB, FC et OB sont importés`]);

  const warnings: string[] = [];
  const version = path(root, "Engineering")?.getAttribute("version");
  const attributes = kid(blockEl, "AttributeList");
  const name = text(kid(attributes, "Name")) || origin.replace(/\.xml$/i, "");
  const language = text(kid(attributes, "ProgrammingLanguage"));
  if (language && language !== "LAD") {
    return fail([
      `Bloc en ${language} : l'import SimaticML ne gère que le LAD. Pour du SCL ou du LIST, exporte une source externe (.scl / .awl).`,
    ]);
  }

  const kind = BLOCK_TAGS[tag];
  const blockType: BlockType = kind === "OB" ? "NETWORK" : kind;
  if (kind === "OB") warnings.push("OB importé comme réseau (NETWORK)");
  const { iface, ret } = readInterface(attributes, warnings);
  if (ret) warnings.push(`Valeur de retour de la FC (${ret}) non conservée`);
  if (blockType === "FC") iface.static = [];
  if (blockType === "NETWORK") Object.assign(iface, emptyInterface());

  const objects = kid(blockEl, "ObjectList");
  const title = multilingual(objects, "Title");
  const summary = multilingual(objects, "Comment").replace(/\n+/g, " ");

  const graphs: FlowGraph[] = [];
  descendants(blockEl, "SW.Blocks.CompileUnit").forEach((unit, i) => {
    const unitAttrs = kid(unit, "AttributeList");
    const unitLang = text(kid(unitAttrs, "ProgrammingLanguage"));
    const unitObjects = kid(unit, "ObjectList");
    const netTitle = multilingual(unitObjects, "Title");
    const netComment = multilingual(unitObjects, "Comment");
    const flgNet = path(unitAttrs, "NetworkSource", "FlgNet");
    if (unitLang && unitLang !== "LAD") {
      warnings.push(`Réseau ${i + 1} (${unitLang}) ignoré : seul le LAD est importé`);
      return;
    }
    if (!flgNet) {
      warnings.push(`Réseau ${i + 1} vide, ignoré`);
      return;
    }
    const r = readNetwork(flgNet, netTitle, netComment);
    warnings.push(...r.warnings.map((w) => `Réseau ${i + 1} : ${w}`));
    if (r.graph) graphs.push(r.graph);
  });

  const { program, warnings: graphWarnings } = graphsToProgram(graphs);
  warnings.push(...graphWarnings);
  if (program.networks.length === 0) return fail(["Aucun réseau LAD importable"], warnings);
  if (version) warnings.unshift(`Export SimaticML TIA ${version}`);

  const lad = printLadder(program);
  const now = new Date().toISOString();
  const id = slugify(name) || "bloc-simaticml";
  const raw = toRawSnippet({
    id,
    meta: {
      schemaVersion: 1,
      title: title || name,
      summary,
      tags: [],
      blockType,
      cpuFamilies: [],
      interface: iface,
      variants: [
        { lang: "LAD", file: "main.lad" },
        { lang: "SCL", file: "main.scl", generated: true },
      ],
      createdAt: now,
      updatedAt: now,
    },
    readme: null,
    files: { "main.lad": lad, "main.scl": ladderToScl(program) },
  });
  const parsed = parseRawSnippet(raw);
  return parsed.ok
    ? { origin, id, snippet: parsed.snippet, errors: [], warnings }
    : { origin, id, snippet: null, errors: parsed.invalid.errors, warnings };
}
