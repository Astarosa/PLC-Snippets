import { checkSnippetLadder, errorsOf, sclComesFromLadder, summarize } from "../ladder/check";
import { parseLadder } from "../ladder/parse";
import { generateScl } from "../snippet/form";
import { parseAddress } from "../snippet/plc-tags";
import type { PlcTag, Snippet, SnippetInterface, Variable } from "../snippet/schema";
import type { ExportResult, FormatAdapter } from "./types";

/*
 * Export PLCopen XML (TC6 v2.01) pour CODESYS et EcoStruxure Machine Expert :
 * Projet → Importer PLCopenXML. Chaque snippet devient une POU dont le corps est
 * en ST, traduit du SCL (écrit à la main ou généré depuis le LADDER).
 *
 *   FB      → functionBlock
 *   FC      → function (type de retour BOOL : CODESYS en exige un)
 *   NETWORK → program
 *
 * Les variables API et les DB d'instance globaux ("T_Tempo".TON(…)) vont dans une
 * liste de variables globales. Les adresses : seuls les bits d'entrée / sortie
 * (%I0.0 → %IX0.0) sont gardés ; CODESYS numérote les mots autrement que TIA
 * (%MW20 n'y désigne pas les mêmes octets), les autres adresses restent en commentaire.
 */

const XHTML = "http://www.w3.org/1999/xhtml";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Identifiant IEC valide (lettres, chiffres, _), à partir d'un nom TIA. */
export function iecName(name: string): string {
  const n = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return /^[0-9]/.test(n) || n === "" ? `V_${n}` : n;
}

const ELEMENTARY = new Set([
  "BOOL",
  "BYTE",
  "WORD",
  "DWORD",
  "LWORD",
  "SINT",
  "INT",
  "DINT",
  "LINT",
  "USINT",
  "UINT",
  "UDINT",
  "ULINT",
  "REAL",
  "LREAL",
  "TIME",
  "LTIME",
  "DATE",
  "TIME_OF_DAY",
  "DATE_AND_TIME",
  "CHAR",
  "WCHAR",
  "STRING",
  "WSTRING",
]);

const ALIASES: Record<string, string> = {
  TOD: "TIME_OF_DAY",
  DT: "DATE_AND_TIME",
  TON_TIME: "TON",
  TOF_TIME: "TOF",
  TP_TIME: "TP",
  TONR_TIME: "TONR",
  CTU_INT: "CTU",
  CTD_INT: "CTD",
  CTUD_INT: "CTUD",
};

/** Type TIA → élément <type> PLCopen (chaîne XML). */
export function typeXml(type: string, boxKinds: Map<string, string> = new Map(), name = ""): string {
  const t = type.trim();
  const array = /^Array\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*of\s+(.+)$/i.exec(t);
  if (array)
    return `<array><dimension lower="${array[1]}" upper="${array[2]}"/><baseType>${typeXml(array[3])}</baseType></array>`;
  const str = /^(W?STRING)\s*\[\s*(\d+)\s*\]$/i.exec(t);
  if (str) return `<${str[1].toLowerCase()} length="${str[2]}"/>`;
  const upper = t.toUpperCase();
  if (upper === "STRING") return "<string/>";
  if (upper === "WSTRING") return "<wstring/>";
  if (ELEMENTARY.has(upper)) return `<${upper}/>`;
  if (ALIASES[upper] && ELEMENTARY.has(ALIASES[upper])) return `<${ALIASES[upper]}/>`;
  // Instance de temporisation / compteur : type d'après la boîte du LADDER si on la connaît.
  if (upper === "IEC_TIMER" || upper === "IEC_COUNTER" || upper.endsWith("_TIME") || upper.endsWith("_INT")) {
    const kind = boxKinds.get(name) ?? ALIASES[upper] ?? (upper === "IEC_TIMER" ? "TON" : "CTU");
    return `<derived name="${kind}"/>`;
  }
  return `<derived name="${esc(t.replace(/"/g, ""))}"/>`;
}

const doc = (text: string | undefined) =>
  text ? `<documentation><xhtml:p xmlns:xhtml="${XHTML}">${esc(text)}</xhtml:p></documentation>` : "";

function variableXml(v: Variable, boxKinds: Map<string, string>, indent: string): string {
  const init = v.initial ? `<initialValue><simpleValue value="${esc(v.initial)}"/></initialValue>` : "";
  return `${indent}<variable name="${esc(iecName(v.name))}"><type>${typeXml(v.type, boxKinds, v.name)}</type>${init}${doc(v.comment)}</variable>`;
}

/**
 * SCL de TIA → ST IEC : `#Locale` → `Locale`, `"Global"` → `Global` (renommé s'il le faut),
 * `"DB".TON(…)` → `DB(…)` (instance globale), REGION en commentaire. Les commentaires et
 * les chaînes '…' ne sont pas touchés.
 */
export function sclToSt(scl: string): {
  st: string;
  instances: Map<string, string>;
  renamed: Map<string, string>;
} {
  const instances = new Map<string, string>();
  const renamed = new Map<string, string>();
  const name = (raw: string) => {
    const n = iecName(raw);
    if (n !== raw) renamed.set(raw, n);
    return n;
  };
  let out = "";
  let i = 0;
  while (i < scl.length) {
    const c = scl[i];
    const rest = scl.slice(i);
    if (rest.startsWith("//")) {
      const end = scl.indexOf("\n", i);
      const stop = end < 0 ? scl.length : end;
      out += scl.slice(i, stop);
      i = stop;
    } else if (rest.startsWith("(*")) {
      const end = scl.indexOf("*)", i + 2);
      const stop = end < 0 ? scl.length : end + 2;
      out += scl.slice(i, stop);
      i = stop;
    } else if (c === "'") {
      const end = scl.indexOf("'", i + 1);
      const stop = end < 0 ? scl.length : end + 1;
      out += scl.slice(i, stop);
      i = stop;
    } else if (c === '"' || (c === "#" && scl[i + 1] === '"')) {
      const start = c === "#" ? i + 1 : i;
      const end = scl.indexOf('"', start + 1);
      if (end < 0) {
        out += scl.slice(i);
        break;
      }
      const ident = name(scl.slice(start + 1, end));
      i = end + 1;
      // Appel d'une instance globale à la TIA : "T".TON(…) → T(…)
      const call = c === '"' ? /^\.(TONR|TON|TOF|TP|CTUD|CTU|CTD)\s*\(/i.exec(scl.slice(i)) : null;
      if (call) {
        instances.set(ident, call[1].toUpperCase());
        out += ident;
        i += call[0].length - 1;
      } else out += ident;
    } else if (c === "#" && /[A-Za-z_]/.test(scl[i + 1] ?? "") && !/\w/.test(scl[i - 1] ?? "")) {
      // #Locale → Locale ; T#5S, 16#FF restent tels quels.
      i++;
    } else if (/^\bEND_REGION\b/i.test(rest) && (i === 0 || !/\w/.test(scl[i - 1]))) {
      out += "// END_REGION";
      i += "END_REGION".length;
    } else if (/^REGION\b/i.test(rest) && (i === 0 || !/\w/.test(scl[i - 1]))) {
      const end = scl.indexOf("\n", i);
      const stop = end < 0 ? scl.length : end;
      out += `// ${scl.slice(i, stop)}`;
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return { st: out, instances, renamed };
}

/** Code SCL du snippet (écrit ou généré depuis le LADDER), après les contrôles du LADDER. */
function sclOf(snippet: Snippet): { ok: true; scl: string } | { ok: false; error: string } {
  if (sclComesFromLadder(snippet)) {
    const errors = errorsOf(checkSnippetLadder(snippet));
    if (errors.length > 0)
      return { ok: false, error: `LADDER à corriger avant export — ${summarize(errors)}` };
  }
  const scl = snippet.variants.find((v) => v.lang === "SCL");
  if (scl) return { ok: true, scl: scl.content };
  const lad = snippet.variants.find((v) => v.lang === "LAD");
  if (!lad) return { ok: false, error: "ni SCL ni LADDER à traduire en ST" };
  const generated = generateScl(lad.content);
  return generated.ok ? { ok: true, scl: generated.scl } : { ok: false, error: generated.error };
}

/** Instances de temporisations / compteurs du LADDER : nom → type de boîte. */
function ladderBoxes(snippet: Snippet): Map<string, string> {
  const kinds = new Map<string, string>();
  const lad = snippet.variants.find((v) => v.lang === "LAD");
  const parsed = lad ? parseLadder(lad.content) : null;
  if (!parsed?.ok) return kinds;
  const visit = (e: import("../ladder/ast").Expr) => {
    if (e.type === "box" && e.instance) kinds.set(e.instance.text.replace(/^#/, "").replace(/"/g, ""), e.box);
    if (e.type === "series") e.items.forEach(visit);
    if (e.type === "parallel") e.branches.forEach(visit);
  };
  for (const n of parsed.program.networks) for (const r of n.rungs) visit(r.condition);
  return kinds;
}

const SECTIONS: { key: keyof SnippetInterface; tag: string; constant?: boolean }[] = [
  { key: "input", tag: "inputVars" },
  { key: "output", tag: "outputVars" },
  { key: "inOut", tag: "inOutVars" },
  { key: "static", tag: "localVars" },
  { key: "temp", tag: "tempVars" },
  { key: "constant", tag: "localVars", constant: true },
];

export const pouName = (snippet: Snippet) =>
  iecName(
    `${{ FB: "FB", FC: "FC", NETWORK: "PRG" }[snippet.meta.blockType]}_${snippet.id
      .split(/[-_]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join("")}`,
  );

interface Pou {
  xml: string;
  globals: PlcTag[];
  instances: Map<string, string>;
  warnings: string[];
}

function pouXml(snippet: Snippet): { ok: true; pou: Pou } | { ok: false; error: string } {
  const source = sclOf(snippet);
  if (!source.ok) return source;
  const { st, instances, renamed } = sclToSt(source.scl);
  const warnings: string[] = [];
  const kinds = ladderBoxes(snippet);
  const type = { FB: "functionBlock", FC: "function", NETWORK: "program" }[snippet.meta.blockType];
  const iface = snippet.meta.interface;
  const blocks: string[] = [];
  if (type === "function") {
    blocks.push("        <returnType><BOOL/></returnType>");
    warnings.push("FC exportée en FUNCTION avec un type de retour BOOL (exigé par CODESYS).");
  }
  for (const { key, tag, constant } of SECTIONS) {
    let vars = iface[key];
    if (key === "static" && type !== "functionBlock") vars = [];
    if (vars.length === 0) continue;
    blocks.push(
      `          <${tag}${constant ? ' constant="true"' : ""}>`,
      ...vars.map((v) => variableXml(v, kinds, "            ")),
      `          </${tag}>`,
    );
  }
  for (const [from, to] of renamed)
    warnings.push(`« ${from} » renommé ${to} (nom IEC sans espace ni accent).`);
  const body = st.replace(/\]\]>/g, "]]]]><![CDATA[>").replace(/\n+$/, "");
  const xml = [
    `      <pou name="${esc(pouName(snippet))}" pouType="${type}">`,
    "        <interface>",
    ...blocks,
    "        </interface>",
    "        <body>",
    `          <ST><xhtml:p xmlns:xhtml="${XHTML}"><![CDATA[${body}\n]]></xhtml:p></ST>`,
    "        </body>",
    snippet.meta.summary || snippet.meta.title
      ? `        ${doc(`${snippet.meta.title}${snippet.meta.summary ? ` — ${snippet.meta.summary}` : ""}`)}`
      : "",
    "      </pou>",
  ]
    .filter(Boolean)
    .join("\n");
  return { ok: true, pou: { xml, globals: snippet.meta.plcTags, instances, warnings } };
}

/** Variable globale : bit d'E/S gardé (%IX0.0), autre adresse TIA en commentaire. */
function globalXml(tag: PlcTag): { xml: string; movedAddress: boolean } {
  const a = tag.address ? parseAddress(tag.address) : null;
  const io = a && a.size === "X" && a.area !== "M";
  const address = io ? ` address="%${a.area}X${a.byte}.${a.bit}"` : "";
  const comment = [tag.comment, a && !io ? `TIA : ${tag.address}` : ""].filter(Boolean).join(" — ");
  return {
    xml: `          <variable name="${esc(iecName(tag.name))}"${address}><type>${typeXml(tag.type)}</type>${doc(comment)}</variable>`,
    movedAddress: Boolean(a && !io),
  };
}

export function plcopenProject(
  snippets: Snippet[],
  now = new Date().toISOString(),
): { xml: string; warnings: string[] } {
  const warnings: string[] = [];
  const pous: string[] = [];
  const globals = new Map<string, PlcTag>();
  const instances = new Map<string, string>();
  for (const snippet of snippets) {
    const r = pouXml(snippet);
    const prefix = snippets.length > 1 ? `${snippet.meta.title} : ` : "";
    if (!r.ok) {
      warnings.push(`${prefix}${r.error}`);
      continue;
    }
    pous.push(r.pou.xml);
    warnings.push(...r.pou.warnings.map((w) => `${prefix}${w}`));
    for (const t of r.pou.globals)
      if (!globals.has(t.name.toLowerCase())) globals.set(t.name.toLowerCase(), t);
    for (const [n, k] of r.pou.instances) instances.set(n, k);
  }
  if (pous.length === 0) throw new Error(warnings.join("\n") || "Aucun snippet exportable.");

  const globalLines: string[] = [];
  const moved: string[] = [];
  for (const tag of globals.values()) {
    const g = globalXml(tag);
    globalLines.push(g.xml);
    if (g.movedAddress) moved.push(`${tag.name} (${tag.address})`);
  }
  for (const [n, kind] of instances)
    globalLines.push(
      `          <variable name="${esc(n)}"><type><derived name="${kind}"/></type>${doc("Instance (DB d'instance dans TIA)")}</variable>`,
    );
  if (moved.length > 0)
    warnings.push(
      `Adresses TIA gardées en commentaire, à affecter dans CODESYS (numérotation différente) : ${moved.join(", ")}.`,
    );
  if (globalLines.length > 0)
    warnings.push("Variables globales dans la liste GVL_PLCSnippets (configuration PLCSnippets).");
  const counters = [...instances.values(), ...snippets.flatMap((sn) => [...ladderBoxes(sn).values()])].some(
    (k) => k.startsWith("CT"),
  );
  if (counters)
    warnings.push(
      "Compteurs : dans CODESYS, PV et CV sont des WORD (INT dans TIA), conversion implicite signalée.",
    );
  warnings.push("Corps en ST, traduit du SCL : à relire dans CODESYS / Machine Expert avant usage.");

  const instancesXml =
    globalLines.length > 0
      ? [
          "  <instances>",
          "    <configurations>",
          '      <configuration name="PLCSnippets">',
          '        <resource name="Application">',
          '        <globalVars name="GVL_PLCSnippets">',
          ...globalLines,
          "        </globalVars>",
          "        </resource>",
          "      </configuration>",
          "    </configurations>",
          "  </instances>",
        ]
      : ["  <instances>", "    <configurations/>", "  </instances>"];

  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<project xmlns="http://www.plcopen.org/xml/tc6_0200">',
    `  <fileHeader companyName="" productName="PLC Snippets" productVersion="1" creationDateTime="${now.slice(0, 19)}"/>`,
    `  <contentHeader name="PLC Snippets" modificationDateTime="${now.slice(0, 19)}">`,
    "    <coordinateInfo>",
    '      <fbd><scaling x="1" y="1"/></fbd>',
    '      <ld><scaling x="1" y="1"/></ld>',
    '      <sfc><scaling x="1" y="1"/></sfc>',
    "    </coordinateInfo>",
    "  </contentHeader>",
    "  <types>",
    "    <dataTypes/>",
    "    <pous>",
    ...pous,
    "    </pous>",
    "  </types>",
    ...instancesXml,
    "</project>",
    "",
  ].join("\n");
  return { xml, warnings };
}

export const plcopenAdapter: FormatAdapter = {
  id: "plcopen",
  label: "PLCopen XML (.xml)",
  family: "Schneider / CODESYS",
  lossless: false,
  keeps: "interface, variables, code en ST",
  canExport: (snippet) =>
    snippet.variants.some((v) => v.lang === "SCL" || v.lang === "LAD") ? null : "ni SCL ni LADDER",
  export(snippets: Snippet[]): ExportResult {
    const { xml, warnings } = plcopenProject(snippets);
    const name = snippets.length === 1 ? pouName(snippets[0]) : `${snippets.length}-snippets`;
    return { kind: "text", fileName: `${name}.xml`, extension: "xml", content: xml, warnings };
  },
};
