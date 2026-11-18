import { BOX_SPECS, type Expr, type Output, type Value } from "../../ladder/ast";
import { type FlowNode, networkToGraph } from "../../ladder/graph";
import { parseLadder } from "../../ladder/parse";
import type { Snippet, SnippetInterface, Variable } from "../../snippet/schema";

/*
 * Écriture d'un bloc LAD au format SimaticML (TIA Portal V17 : Interface v5, FlgNet v4).
 * EXPÉRIMENTAL : construit d'après la structure des exports Openness, pas encore validé par
 * un import réel dans TIA. Les UId sont uniques dans tout le bloc (plus sûr à l'import).
 */

const NS_INTERFACE = "http://www.siemens.com/automation/Openness/SW/Interface/v5";
const NS_FLGNET = "http://www.siemens.com/automation/Openness/SW/NetworkSource/FlgNet/v4";
const CULTURE = "fr-FR";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export class SimaticMlExportError extends Error {}

/* ---------- Interface ---------- */

const SECTIONS: [keyof SnippetInterface, string][] = [
  ["input", "Input"],
  ["output", "Output"],
  ["inOut", "InOut"],
  ["static", "Static"],
  ["temp", "Temp"],
  ["constant", "Constant"],
];

function memberXml(v: Variable, isStatic: boolean): string {
  const quoted =
    /^[A-Za-z_]\w*$/.test(v.type) || /^(Array|String|WString)\b/i.test(v.type) ? v.type : `"${v.type}"`;
  const attrs = `Name="${esc(v.name)}" Datatype="${esc(quoted)}"${isStatic ? ' Remanence="NonRetain" Accessibility="Public"' : ""}`;
  const inner = [
    v.comment
      ? `      <Comment>\n        <MultiLanguageText Lang="${CULTURE}">${esc(v.comment)}</MultiLanguageText>\n      </Comment>`
      : "",
    v.initial ? `      <StartValue>${esc(v.initial)}</StartValue>` : "",
  ].filter(Boolean);
  return inner.length === 0
    ? `    <Member ${attrs} />`
    : `    <Member ${attrs}>\n${inner.join("\n")}\n    </Member>`;
}

function interfaceXml(iface: SnippetInterface, isFb: boolean): string {
  const lines = [`<Interface><Sections xmlns="${NS_INTERFACE}">`];
  for (const [key, name] of SECTIONS) {
    if (key === "static" && !isFb) continue;
    const vars = iface[key];
    if (vars.length === 0) lines.push(`  <Section Name="${name}" />`);
    else
      lines.push(
        `  <Section Name="${name}">`,
        ...vars.map((v) => memberXml(v, key === "static")),
        "  </Section>",
      );
  }
  if (!isFb)
    lines.push('  <Section Name="Return">', '    <Member Name="Ret_Val" Datatype="Void" />', "  </Section>");
  lines.push("</Sections></Interface>");
  return lines.join("\n");
}

/* ---------- Textes multilingues ---------- */

class Ids {
  private n = 0;
  /** ID hexadécimal des objets du document (MultilingualText, CompileUnit…). */
  object = () => (this.n++).toString(16).toUpperCase();
}

function multilingualXml(ids: Ids, composition: string, value: string, indent: string): string {
  return [
    `${indent}<MultilingualText ID="${ids.object()}" CompositionName="${composition}">`,
    `${indent}  <ObjectList>`,
    `${indent}    <MultilingualTextItem ID="${ids.object()}" CompositionName="Items">`,
    `${indent}      <AttributeList>`,
    `${indent}        <Culture>${CULTURE}</Culture>`,
    `${indent}        <Text>${esc(value)}</Text>`,
    `${indent}      </AttributeList>`,
    `${indent}    </MultilingualTextItem>`,
    `${indent}  </ObjectList>`,
    `${indent}</MultilingualText>`,
  ].join("\n");
}

/* ---------- Réseau → FlgNet ---------- */

const COMPARE_PARTS: Record<string, string> = {
  "==": "Eq",
  "<>": "Ne",
  ">": "Gt",
  "<": "Lt",
  ">=": "Ge",
  "<=": "Le",
};
const MATH_PARTS: Record<string, string> = { MOVE: "Move", ADD: "Add", SUB: "Sub", MUL: "Mul", DIV: "Div" };

/** Découpe « "DB".a.b » ou « #x.y » en composants. */
function components(text: string): string[] {
  const parts: string[] = [];
  const re = /"([^"]*)"|#?([A-Za-z_]\w*)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) parts.push(m[1] ?? m[2]);
  return parts;
}

type TypeOf = (v: Value) => string | null;

class NetworkWriter {
  private parts: string[] = [];
  private wires: string[] = [];
  /** Destinations par source (une source = un Wire). */
  private fanout = new Map<string, { source: string; targets: string[] }>();
  readonly warnings: string[] = [];

  constructor(
    private uid: () => number,
    private typeOf: TypeOf,
  ) {}

  private access(value: Value): number {
    const id = this.uid();
    if (value.kind === "literal") {
      const v = value.text;
      if (/^[A-Z_]+#/.test(v) && !/^16#|^2#|^8#/.test(v)) {
        this.parts.push(
          `    <Access Scope="TypedConstant" UId="${id}">\n      <Constant>\n        <ConstantValue>${esc(v)}</ConstantValue>\n      </Constant>\n    </Access>`,
        );
      } else {
        const type = /^(TRUE|FALSE)$/.test(v) ? "Bool" : /[.E]/.test(v) && !/#/.test(v) ? "Real" : "Int";
        this.parts.push(
          `    <Access Scope="LiteralConstant" UId="${id}">\n      <Constant>\n        <ConstantType>${type}</ConstantType>\n        <ConstantValue>${esc(v)}</ConstantValue>\n      </Constant>\n    </Access>`,
        );
      }
      return id;
    }
    if (value.kind === "absolute") {
      throw new SimaticMlExportError(
        `Adresse absolue ${value.text} : utilise une variable API (mnémonique) pour l'export SimaticML`,
      );
    }
    const comps = components(value.text)
      .map((c) => `<Component Name="${esc(c)}" />`)
      .join("");
    this.parts.push(
      `    <Access Scope="${value.kind === "local" ? "LocalVariable" : "GlobalVariable"}" UId="${id}">\n      <Symbol>${comps}</Symbol>\n    </Access>`,
    );
    return id;
  }

  private link(sourceKey: string, sourceXml: string, targetXml: string) {
    const entry = this.fanout.get(sourceKey) ?? { source: sourceXml, targets: [] };
    entry.targets.push(targetXml);
    this.fanout.set(sourceKey, entry);
  }

  /** Relie un opérande (ou une constante) à une broche d'entrée. */
  private input(partUid: number, pin: string, value: Value) {
    const a = this.access(value);
    this.wires.push(
      `    <Wire UId="${this.uid()}">\n      <IdentCon UId="${a}" />\n      <NameCon UId="${partUid}" Name="${pin}" />\n    </Wire>`,
    );
  }

  /** Relie une broche de sortie à un opérande. */
  private output(partUid: number, pin: string, value: Value) {
    const a = this.access(value);
    this.wires.push(
      `    <Wire UId="${this.uid()}">\n      <NameCon UId="${partUid}" Name="${pin}" />\n      <IdentCon UId="${a}" />\n    </Wire>`,
    );
  }

  /** Point de sortie du flux d'un nœud (clé + XML de la source du Wire). */
  private flowOut = new Map<string, { key: string; xml: string }>();
  /** Jonctions OU déjà créées pour un ensemble de sources. */
  private joins = new Map<string, { key: string; xml: string }>();

  private sourcePoint(sources: (string | null)[]): { key: string; xml: string } {
    if (sources.length === 1) {
      const s = sources[0];
      if (s === null) return { key: "rail", xml: "<Powerrail />" };
      const out = this.flowOut.get(s);
      if (!out) throw new SimaticMlExportError("ordre des éléments inattendu");
      return out;
    }
    const joinKey = JSON.stringify(sources);
    const existing = this.joins.get(joinKey);
    if (existing) return existing;
    // OU : Part « O » à N entrées, chaque source sur inK.
    const o = this.uid();
    this.parts.push(
      `    <Part Name="O" UId="${o}">\n      <TemplateValue Name="Card" Type="Cardinality">${sources.length}</TemplateValue>\n    </Part>`,
    );
    sources.forEach((s, i) => {
      const point = this.sourcePoint([s]);
      this.link(point.key, point.xml, `<NameCon UId="${o}" Name="in${i + 1}" />`);
    });
    const point = { key: `${o}.out`, xml: `<NameCon UId="${o}" Name="out" />` };
    this.joins.set(joinKey, point);
    return point;
  }

  node(node: FlowNode) {
    const uid = this.uid();
    const flowIn = (pin: string) => {
      const point = this.sourcePoint(node.sources);
      this.link(point.key, point.xml, `<NameCon UId="${uid}" Name="${pin}" />`);
    };

    if (node.kind === "coil") {
      const o: Output = node.output;
      const name = o.kind === "SET" ? "SCoil" : o.kind === "RESET" ? "RCoil" : "Coil";
      const negated = o.kind === "NCOIL" ? '\n      <Negated Name="operand" />\n    ' : "";
      this.parts.push(
        negated
          ? `    <Part Name="${name}" UId="${uid}">${negated}</Part>`
          : `    <Part Name="${name}" UId="${uid}" />`,
      );
      flowIn("in");
      this.input(uid, "operand", o.operand);
      this.flowOut.set(node.id, { key: `${uid}.out`, xml: `<NameCon UId="${uid}" Name="out" />` });
      return;
    }

    const e: Expr = node.element;
    let outPin = "out";
    switch (e.type) {
      case "contact": {
        const neg = e.kind === "NC" ? '\n      <Negated Name="operand" />\n    ' : "";
        this.parts.push(
          neg
            ? `    <Part Name="Contact" UId="${uid}">${neg}</Part>`
            : `    <Part Name="Contact" UId="${uid}" />`,
        );
        flowIn("in");
        this.input(uid, "operand", e.operand);
        break;
      }
      case "edge":
        this.parts.push(`    <Part Name="${e.kind === "P" ? "PContact" : "NContact"}" UId="${uid}" />`);
        flowIn("in");
        this.input(uid, "operand", e.operand);
        this.input(uid, "bit", e.memory);
        break;
      case "compare": {
        const type = this.typeOf(e.left) ?? this.typeOf(e.right);
        if (!type)
          this.warnings.push(`Comparateur ${e.left.text} ${e.op} ${e.right.text} : type supposé Int`);
        this.parts.push(
          `    <Part Name="${COMPARE_PARTS[e.op]}" UId="${uid}">\n      <TemplateValue Name="SrcType" Type="Type">${type ?? "Int"}</TemplateValue>\n    </Part>`,
        );
        flowIn("pre");
        this.input(uid, "in1", e.left);
        this.input(uid, "in2", e.right);
        break;
      }
      case "box": {
        const spec = BOX_SPECS[e.box];
        if (e.box in MATH_PARTS) {
          const name = MATH_PARTS[e.box];
          if (e.box === "MOVE") {
            this.parts.push(
              `    <Part Name="Move" DisabledENO="true" UId="${uid}">\n      <TemplateValue Name="Card" Type="Cardinality">1</TemplateValue>\n    </Part>`,
            );
            flowIn("en");
            this.input(uid, "in", e.params.IN);
            this.output(uid, "out1", e.params.OUT);
          } else {
            const type = this.typeOf(e.params.OUT) ?? this.typeOf(e.params.IN1) ?? this.typeOf(e.params.IN2);
            if (!type) this.warnings.push(`${e.box} : type supposé Int`);
            this.parts.push(
              `    <Part Name="${name}" DisabledENO="true" UId="${uid}">\n      <TemplateValue Name="Card" Type="Cardinality">2</TemplateValue>\n      <TemplateValue Name="SrcType" Type="Type">${type ?? "Int"}</TemplateValue>\n    </Part>`,
            );
            flowIn("en");
            this.input(uid, "in1", e.params.IN1);
            this.input(uid, "in2", e.params.IN2);
            this.output(uid, "out", e.params.OUT);
          }
          outPin = "eno";
        } else {
          const inst = e.instance;
          if (!inst) throw new SimaticMlExportError(`${e.box} sans instance`);
          const instUid = this.uid();
          const comps = components(inst.text)
            .map((c) => `<Component Name="${esc(c)}" />`)
            .join("");
          const isTimer = e.box.startsWith("T");
          const pv = e.params.PV ? this.typeOf(e.params.PV) : null;
          const template = isTimer
            ? '<TemplateValue Name="time_type" Type="Type">Time</TemplateValue>'
            : `<TemplateValue Name="value_type" Type="Type">${pv ?? "Int"}</TemplateValue>`;
          this.parts.push(
            `    <Part Name="${e.box}" Version="1.0" UId="${uid}">\n      <Instance Scope="${inst.kind === "local" ? "LocalVariable" : "GlobalVariable"}" UId="${instUid}">${comps}</Instance>\n      ${template}\n    </Part>`,
          );
          flowIn(spec.mainIn);
          for (const p of spec.inputs) if (e.params[p]) this.input(uid, p, e.params[p]);
          for (const p of spec.outputs) if (e.params[p]) this.output(uid, p, e.params[p]);
          outPin = spec.mainOut;
        }
        break;
      }
      default:
        throw new SimaticMlExportError("élément inattendu");
    }
    this.flowOut.set(node.id, { key: `${uid}.${outPin}`, xml: `<NameCon UId="${uid}" Name="${outPin}" />` });
  }

  xml(): string {
    const flowWires = [...this.fanout.values()].map(
      ({ source, targets }) =>
        `    <Wire UId="${this.uid()}">\n      ${source}\n${targets.map((t) => `      ${t}`).join("\n")}\n    </Wire>`,
    );
    return [
      `<NetworkSource><FlgNet xmlns="${NS_FLGNET}">`,
      "  <Parts>",
      ...this.parts,
      "  </Parts>",
      "  <Wires>",
      ...flowWires,
      ...this.wires,
      "  </Wires>",
      "</FlgNet></NetworkSource>",
    ].join("\n");
  }
}

/* ---------- Bloc complet ---------- */

export interface SimaticMlExport {
  xml: string;
  fileName: string;
  warnings: string[];
}

export function writeSimaticMl(snippet: Snippet, blockName: string, blockNumber = 1): SimaticMlExport {
  const lad = snippet.variants.find((v) => v.lang === "LAD");
  if (!lad) throw new SimaticMlExportError("pas de LADDER");
  const parsed = parseLadder(lad.content);
  if (!parsed.ok) throw new SimaticMlExportError(`LADDER invalide : ${parsed.error.message}`);

  const isFb = snippet.meta.blockType === "FB";
  const iface = snippet.meta.interface;
  const localTypes = new Map(
    (Object.values(iface) as Variable[][]).flat().map((v) => [v.name.toLowerCase(), v.type] as const),
  );
  const typeOf: TypeOf = (v) => {
    if (v.kind === "local") return localTypes.get(components(v.text)[0]?.toLowerCase() ?? "") ?? null;
    if (v.kind === "literal") {
      if (/^T#/.test(v.text)) return "Time";
      if (/^(TRUE|FALSE)$/.test(v.text)) return "Bool";
      if (/^[+-]?\d+$/.test(v.text)) return null; // entier : le type de l'autre opérande décide
      if (/^[+-]?\d+\.\d+/.test(v.text)) return "Real";
    }
    return null;
  };

  const ids = new Ids();
  let nextUid = 20;
  const uid = () => ++nextUid;
  const warnings: string[] = [
    "Export SimaticML expérimental : vérifie l'import dans TIA avant de t'en servir",
  ];
  if (blockNumber === 1) warnings.push("Numéro de bloc 1 : à changer dans TIA si besoin");

  ids.object(); // ID 0 : le bloc
  const blockComment = multilingualXml(ids, "Comment", snippet.meta.summary, "      ");
  const units = parsed.program.networks.map((network) => {
    const writer = new NetworkWriter(uid, typeOf);
    const graph = networkToGraph(network);
    for (const node of graph.nodes) writer.node(node);
    warnings.push(...writer.warnings);
    const unitId = ids.object();
    const comment = multilingualXml(ids, "Comment", network.comment ?? "", "          ");
    const title = multilingualXml(ids, "Title", network.title ?? "", "          ");
    return [
      `      <SW.Blocks.CompileUnit ID="${unitId}" CompositionName="CompileUnits">`,
      "        <AttributeList>",
      writer.xml(),
      "          <ProgrammingLanguage>LAD</ProgrammingLanguage>",
      "        </AttributeList>",
      "        <ObjectList>",
      comment,
      title,
      "        </ObjectList>",
      "      </SW.Blocks.CompileUnit>",
    ].join("\n");
  });
  const blockTitle = multilingualXml(ids, "Title", snippet.meta.title, "      ");

  const tag = isFb ? "SW.Blocks.FB" : "SW.Blocks.FC";
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<Document>",
    '  <Engineering version="V17" />',
    `  <${tag} ID="0">`,
    "    <AttributeList>",
    interfaceXml(isFb ? iface : { ...iface, static: [] }, isFb),
    "      <MemoryLayout>Optimized</MemoryLayout>",
    `      <Name>${esc(blockName)}</Name>`,
    `      <Number>${blockNumber}</Number>`,
    "      <ProgrammingLanguage>LAD</ProgrammingLanguage>",
    "      <SetENOAutomatically>false</SetENOAutomatically>",
    "    </AttributeList>",
    "    <ObjectList>",
    blockComment,
    ...units,
    blockTitle,
    "    </ObjectList>",
    `  </${tag}>`,
    "</Document>",
    "",
  ].join("\n");

  return { xml, fileName: `${blockName}.xml`, warnings: [...new Set(warnings)] };
}
