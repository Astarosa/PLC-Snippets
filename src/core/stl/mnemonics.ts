/*
 * Conversion du LIST (STL / AWL) entre mnémoniques allemandes (SIMATIC)
 * et anglaises (internationales).
 *
 * La conversion se fait par POSITION, jamais par simple rechercher/remplacer :
 * - en allemand « A » est une zone d'opérande (Ausgang = sortie), en anglais c'est
 *   l'instruction ET : seul le 1er mot de la ligne est une instruction ;
 * - certaines instructions existent dans les deux langues avec un sens différent
 *   (temporisations : SE allemand = SD anglais, SV allemand = SE anglais) : la table
 *   est appliquée une seule fois, dans un seul sens.
 */

export type Mnemonic = "DE" | "EN";

export const MNEMONIC_LABELS: Record<Mnemonic, string> = {
  DE: "Allemand (SIMATIC)",
  EN: "Anglais (international)",
};

/** Instructions qui changent d'une langue à l'autre : [allemand, anglais]. */
const INSTRUCTIONS: [string, string][] = [
  ["U", "A"],
  ["UN", "AN"],
  ["U(", "A("],
  ["UN(", "AN("],
  // Sauts
  ["SPA", "JU"],
  ["SPB", "JC"],
  ["SPBN", "JCN"],
  ["SPBB", "JCB"],
  ["SPBNB", "JNB"],
  ["SPBI", "JBI"],
  ["SPBIN", "JNBI"],
  ["SPO", "JO"],
  ["SPS", "JOS"],
  ["SPZ", "JZ"],
  ["SPN", "JN"],
  ["SPP", "JP"],
  ["SPM", "JM"],
  ["SPPZ", "JPZ"],
  ["SPMZ", "JMZ"],
  ["SPU", "JUO"],
  ["SPL", "JL"],
  // Fin de bloc, DB
  ["BEA", "BEU"],
  ["BEB", "BEC"],
  ["AUF", "OPN"],
  // Compteurs
  ["ZV", "CU"],
  ["ZR", "CD"],
  // Temporisations S5
  ["SI", "SP"],
  ["SV", "SE"],
  ["SE", "SD"],
  ["SA", "SF"],
];

/** Zones d'opérandes qui changent : [allemand, anglais]. */
const AREAS: [string, string][] = [
  ["E", "I"],
  ["EB", "IB"],
  ["EW", "IW"],
  ["ED", "ID"],
  ["A", "Q"],
  ["AB", "QB"],
  ["AW", "QW"],
  ["AD", "QD"],
  ["PEB", "PIB"],
  ["PEW", "PIW"],
  ["PED", "PID"],
  ["PAB", "PQB"],
  ["PAW", "PQW"],
  ["PAD", "PQD"],
  ["Z", "C"],
];

function table(pairs: [string, string][], from: Mnemonic): Map<string, string> {
  return new Map(pairs.map(([de, en]) => (from === "DE" ? [de, en] : [en, de])));
}

const INSTRUCTION_MAPS = { DE: table(INSTRUCTIONS, "DE"), EN: table(INSTRUCTIONS, "EN") };
const AREA_MAPS = { DE: table(AREAS, "DE"), EN: table(AREAS, "EN") };

/** Instructions et zones propres à une langue (pour la détection). */
const ONLY = {
  DE: new Set(["U", "UN", "U(", "UN(", "SPA", "SPB", "SPBN", "AUF", "ZV", "ZR", "BEA", "BEB"]),
  EN: new Set(["A", "AN", "A(", "AN(", "JU", "JC", "JCN", "OPN", "CU", "CD", "BEU", "BEC"]),
};

/** Zone + adresse : « E 0.0 », « %EW10 », « Z 3 »… (zones longues d'abord). */
const AREA_RE =
  /^(%?)(PEB|PEW|PED|PAB|PAW|PAD|PIB|PIW|PID|PQB|PQW|PQD|EB|EW|ED|AB|AW|AD|IB|IW|ID|QB|QW|QD|E|A|I|Q|Z|C)(\s*)(\d+(?:\.\d+)?)(.*)$/i;

function convertOperand(operand: string, from: Mnemonic): string {
  const m = AREA_RE.exec(operand);
  if (!m) return operand; // "Mnémonique", #Locale, constante, M10.0, DB1.DBX0.0… inchangés
  const [, percent, area, space, address, rest] = m;
  const mapped = AREA_MAPS[from].get(area.toUpperCase());
  return mapped ? `${percent}${mapped}${space}${address}${rest}` : operand;
}

interface StlLine {
  indent: string;
  label: string; // « M001: » ou vide
  instruction: string;
  gap: string;
  operand: string;
  tail: string; // « ; » et commentaire
}

/** Découpe une ligne : [étiquette:] instruction [opérande] [;] [// commentaire] */
function splitLine(line: string): StlLine | null {
  const m = /^(\s*)((?:[A-Za-z_]\w{0,3}:\s*)?)([^\s;/]+)(\s*)([^;]*?)(\s*;?\s*(?:\/\/.*)?)$/.exec(line);
  if (!m) return null;
  const [, indent, label, instruction, gap, operand, tail] = m;
  return { indent, label, instruction, gap, operand, tail };
}

/** Ligne de paramètre d'un CALL : « IN := E 0.0 » */
const PARAM_RE = /^(\s*[A-Za-z_]\w*\s*:=\s*)([^;,/]*?)(\s*[,;]?\s*(?:\/\/.*)?)$/;

export function convertStl(source: string, from: Mnemonic, to: Mnemonic): string {
  if (from === to) return source;
  return source
    .split("\n")
    .map((line) => {
      if (/^\s*(\/\/|$)/.test(line) || /^\s*(NETWORK|TITLE)\b/i.test(line)) return line;
      const param = PARAM_RE.exec(line);
      if (param) return `${param[1]}${convertOperand(param[2], from)}${param[3]}`;
      const parts = splitLine(line);
      if (!parts) return line;
      const upper = parts.instruction.toUpperCase();
      const instruction = INSTRUCTION_MAPS[from].get(upper) ?? parts.instruction;
      const operand = parts.operand ? convertOperand(parts.operand, from) : "";
      // Garde l'opérande dans la même colonne quand l'instruction change de longueur (SPB → JC).
      const shift = parts.instruction.length - instruction.length;
      const gap =
        parts.gap.length > 0 && !parts.gap.includes("\t")
          ? " ".repeat(Math.max(1, parts.gap.length + shift))
          : parts.gap;
      return `${parts.indent}${parts.label}${instruction}${gap}${operand}${parts.tail}`;
    })
    .join("\n");
}

/** Devine la mnémonique d'un texte LIST (null si rien de décisif). */
export function detectMnemonic(source: string): Mnemonic | null {
  const score = { DE: 0, EN: 0 };
  for (const line of source.split("\n")) {
    const parts = splitLine(line);
    if (!parts || /^\s*\/\//.test(line)) continue;
    const upper = parts.instruction.toUpperCase();
    if (ONLY.DE.has(upper)) score.DE++;
    if (ONLY.EN.has(upper)) score.EN++;
    const area = AREA_RE.exec(parts.operand)?.[2]?.toUpperCase();
    if (area && /^(E|EB|EW|ED|PE.|PA.|Z)$/.test(area)) score.DE++;
    if (area && /^(I|IB|IW|ID|Q|QB|QW|QD|PI.|PQ.|C)$/.test(area)) score.EN++;
  }
  if (score.DE === score.EN) return null;
  return score.DE > score.EN ? "DE" : "EN";
}
