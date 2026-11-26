import { findTag } from "../snippet/plc-tags";
import type { PlcTag, SnippetInterface } from "../snippet/schema";
import { convertStl, type Mnemonic } from "../stl/mnemonics";
import {
  BOX_SPECS,
  type Expr,
  type LadProgram,
  type Operand,
  type Output,
  type Rung,
  type Value,
} from "./ast";

/*
 * Génération du LIST (STL / AWL) équivalent à un programme LADDER, pour S7-300/400 et S7-1500.
 *
 * Le code est produit en mnémonique allemande puis converti si besoin (même convertisseur
 * que l'éditeur). Principe, comme TIA quand il traduit du CONT en LIST :
 * - série → « U » ; branche parallèle → « U( » … « O » … « ) » ; contact NF → « UN » / « ON » ;
 * - comparateur → « U( L a / L b / >=I ) » ; front → « U( U op / FP mémoire ) » ;
 * - temporisation / compteur : le RLO entrant est écrit sur l'entrée de l'instance
 *   (« = "T".IN »), puis « CALL », et le fil repart de la sortie (« U "T".Q ») ;
 * - MOVE / calcul : exécuté seulement si EN = 1 (« SPBNB »), le fil repart de ENO (« U BIE ») ;
 * - bobines : « = », « S », « R » ; bobine inverse : « NOT / = / NOT ».
 *
 * Boîte dans une branche parallèle : elle est exécutée avant la logique du rung, avec sa propre
 * condition (les contacts qui la précèdent sur son chemin, ligne principale comprise). Dans la
 * logique du rung, une temporisation / un compteur devient alors un contact sur sa sortie
 * (« O "T".Q ») et un MOVE / calcul laisse passer le courant (ENO = EN). Limite : pas de front ni
 * d'autre boîte avant elle sur ce chemin (les réévaluer fausserait le front ou l'ordre d'exécution).
 */

export interface StlContext {
  mnemonic: Mnemonic;
  /** Interface du bloc : types des variables locales (#x). */
  iface?: SnippetInterface;
  /** Variables API : types des variables globales ("x"). */
  plcTags?: PlcTag[];
}

export type StlResult = { ok: true; stl: string; warnings: string[] } | { ok: false; error: string };

class StlError extends Error {}

type Box = Extract<Expr, { type: "box" }>;

/** Toujours passant : MOVE / calcul (ENO = EN), série de tels éléments, ou parallèle dont une branche l'est. */
function alwaysTrue(e: Expr): boolean {
  if (e.type === "box") return !BOX_SPECS[e.box].instance;
  if (e.type === "series") return e.items.every(alwaysTrue);
  if (e.type === "parallel") return e.branches.some(alwaysTrue);
  return false;
}

/** Contient un front ou une boîte (à ne pas réévaluer). */
function hasSideEffect(e: Expr): boolean {
  if (e.type === "edge" || e.type === "box") return true;
  if (e.type === "series") return e.items.some(hasSideEffect);
  if (e.type === "parallel") return e.branches.some(hasSideEffect);
  return false;
}

/** Boîtes placées dans une branche parallèle, avec les éléments qui les précèdent sur leur chemin. */
function branchBoxes(condition: Expr): { box: Box; before: Expr[] }[] {
  const found: { box: Box; before: Expr[] }[] = [];
  const walk = (e: Expr, before: Expr[], inBranch: boolean) => {
    if (e.type === "box" && inBranch) found.push({ box: e, before });
    else if (e.type === "series")
      e.items.forEach((item, i) => {
        walk(item, [...before, ...e.items.slice(0, i)], inBranch);
      });
    else if (e.type === "parallel") for (const b of e.branches) walk(b, before, true);
  };
  walk(condition, [], false);
  return found;
}

const line = (instruction: string, operand = "") =>
  operand ? `${instruction.padEnd(6)}${operand}` : instruction;

/* ---------- Types (suffixe I / D / R des comparaisons et calculs) ---------- */

type Suffix = "I" | "D" | "R";

function suffixOfType(type: string): Suffix | null {
  const t = type.trim().replace(/^"|"$/g, "").toLowerCase();
  if (/^(int|sint|usint|uint|byte|word)$/.test(t)) return "I";
  if (/^(dint|udint|dword|time)$/.test(t)) return "D";
  if (t === "real") return "R";
  return null;
}

function literalSuffix(text: string): Suffix | null {
  const t = text.toUpperCase();
  if (/^T#|^TIME#|^L#|^DINT#/.test(t)) return "D";
  if (/^[+-]?\d+\.\d+(E[+-]?\d+)?$/.test(t) || /^REAL#/.test(t)) return "R";
  return null; // entier : compatible avec I et D, ne décide pas
}

/* ---------- Génération ---------- */

class Generator {
  lines: string[] = [];
  warnings: string[] = [];
  private labels = 0;

  constructor(private ctx: StlContext) {}

  emit(...ls: string[]) {
    this.lines.push(...ls);
  }

  nextLabel() {
    this.labels++;
    return `M${String(this.labels).padStart(3, "0")}`;
  }

  /** Type d'une valeur, si on le connaît (variable seule, sans membre). */
  suffix(v: Value): Suffix | null {
    if (v.kind === "literal") return literalSuffix(v.text);
    if (v.kind === "local") {
      const m = /^#([A-Za-z_]\w*)$/.exec(v.text);
      if (!m || !this.ctx.iface) return null;
      for (const section of Object.values(this.ctx.iface))
        for (const variable of section)
          if (variable.name.toLowerCase() === m[1].toLowerCase()) return suffixOfType(variable.type);
      return null;
    }
    if (v.kind === "global") {
      const m = /^"([^"]*)"$/.exec(v.text);
      const tag = m && this.ctx.plcTags ? findTag(this.ctx.plcTags, m[1]) : undefined;
      return tag ? suffixOfType(tag.type) : null;
    }
    return null;
  }

  /** Suffixe commun à plusieurs valeurs ; Int supposé (avec avertissement) si aucun n'est connu. */
  suffixOf(values: Value[], what: string): Suffix {
    for (const v of values) {
      const s = this.suffix(v);
      if (s) return s;
    }
    const allLiterals = values.every((v) => v.kind === "literal");
    if (!allLiterals) {
      const names = values.filter((v) => v.kind !== "literal").map((v) => v.text);
      this.warnings.push(
        `${what} : type de ${names.join(" / ")} inconnu, entier 16 bits (I) supposé. Déclare-le dans l'interface ou la table des variables API.`,
      );
    }
    return "I";
  }

  /** Terme logique combiné au RLO courant par « U » (ET) ou « O » (OU). Rien si toujours passant. */
  term(e: Expr, op: "U" | "O"): void {
    if (alwaysTrue(e)) return;
    switch (e.type) {
      case "contact":
        this.emit(line(e.kind === "NC" ? `${op}N` : op, e.operand.text));
        return;
      case "compare": {
        const cmp = e.op === "<>" ? "<>" : e.op;
        const s = this.suffixOf([e.left, e.right], `Comparateur ${e.left.text} ${e.op} ${e.right.text}`);
        this.emit(`${op}(`, line("L", e.left.text), line("L", e.right.text), `${cmp}${s}`, ")");
        return;
      }
      case "edge":
        this.emit(
          `${op}(`,
          line("U", e.operand.text),
          line(e.kind === "P" ? "FP" : "FN", e.memory.text),
          ")",
        );
        return;
      case "series": {
        if (e.items.length === 0) throw new StlError("branche vide : relie-la à un contact.");
        const items = e.items.filter((item) => !alwaysTrue(item));
        if (items.length === 1) {
          this.term(items[0], op);
          return;
        }
        if (op === "U") for (const item of items) this.term(item, "U");
        else {
          this.emit("O(");
          for (const item of items) this.term(item, "U");
          this.emit(")");
        }
        return;
      }
      case "parallel":
        if (e.branches.length === 1) {
          this.term(e.branches[0], op);
          return;
        }
        if (op === "O") for (const b of e.branches) this.term(b, "O");
        else {
          this.emit("U(");
          for (const b of e.branches) this.term(b, "O");
          this.emit(")");
        }
        return;
      case "box":
        // Boîte de branche déjà exécutée avant le rung : le fil continue depuis sa sortie.
        this.emit(line(op, `${(e.instance as Operand).text}.${BOX_SPECS[e.box].mainOut}`));
        return;
    }
  }

  /** Appel d'une temporisation / d'un compteur. Le RLO entrant va sur sa broche principale. */
  instanceBox(e: Extract<Expr, { type: "box" }>, hasIncoming: boolean, continues: boolean) {
    const spec = BOX_SPECS[e.box];
    const inst = e.instance as Operand;
    if (!hasIncoming) this.emit("SET");
    this.emit(line("=", `${inst.text}.${spec.mainIn}`));

    const timer = ["TON", "TOF", "TP", "TONR"].includes(e.box);
    const valueType = timer ? "Time" : this.counterType(e);
    const template = `{${timer ? "time_type" : "value_type"} := '${valueType}'}`;
    this.emit(
      inst.kind === "local" ? line("CALL", inst.text) : line("CALL", `${e.box} , ${inst.text}`),
      template,
    );

    const params = [
      ...spec.inputs.filter((p) => e.params[p]).map((p) => `${p} := ${e.params[p].text}`),
      ...spec.outputs.filter((p) => e.params[p]).map((p) => `${p} => ${e.params[p].text}`),
    ];
    this.emit("(", ...params.map((p, i) => `   ${p}${i < params.length - 1 ? "," : ""}`), ");");

    if (continues) this.emit(line("U", `${inst.text}.${spec.mainOut}`));
  }

  private counterType(e: Extract<Expr, { type: "box" }>): string {
    // Multi-instance déclarée (CTU_INT, CTU_DINT, CTUD_UINT…) : le type est dans son nom.
    const m = e.instance ? /^#([A-Za-z_]\w*)$/.exec(e.instance.text) : null;
    if (m && this.ctx.iface)
      for (const section of Object.values(this.ctx.iface))
        for (const v of section) {
          const t = v.name.toLowerCase() === m[1].toLowerCase() ? /^"?CTU?D?_(\w+?)"?$/i.exec(v.type) : null;
          if (t)
            return (
              {
                INT: "Int",
                DINT: "DInt",
                SINT: "SInt",
                UINT: "UInt",
                UDINT: "UDInt",
                USINT: "USInt",
                LINT: "LInt",
                ULINT: "ULInt",
              }[t[1].toUpperCase()] ?? "Int"
            );
        }
    const s = this.suffixOf(
      [e.params.PV, e.params.CV].filter((v): v is Value => !!v),
      `${e.box} ${e.instance?.text ?? ""}`,
    );
    return s === "D" ? "DInt" : "Int";
  }

  /** MOVE / calcul : exécuté si EN = 1 ; le fil continue avec ENO (= EN). */
  transferBox(
    e: Extract<Expr, { type: "box" }>,
    hasIncoming: boolean,
    continues: "logic" | "outputs" | null,
  ) {
    const p = e.params;
    const label = hasIncoming ? this.nextLabel() : null;
    if (label) this.emit(line("SPBNB", label));
    if (e.box === "MOVE") this.emit(line("L", p.IN.text), line("T", p.OUT.text));
    else {
      const s = this.suffixOf([p.IN1, p.IN2, p.OUT], `${e.box} ${p.OUT.text}`);
      const op = { ADD: "+", SUB: "-", MUL: "*", DIV: "/" }[e.box as "ADD"];
      this.emit(line("L", p.IN1.text), line("L", p.IN2.text), `${op}${s}`, line("T", p.OUT.text));
    }
    if (label) this.emit(continues ? `${label}: ${line("U", "BIE")}` : `${label}: NOP 0`);
    else if (continues === "outputs") this.emit("SET");
  }

  /** Boîtes des branches parallèles, exécutées avant la logique du rung avec leur condition. */
  branchBoxes(condition: Expr) {
    for (const { box, before } of branchBoxes(condition)) {
      const blocking = before.find(hasSideEffect);
      if (blocking)
        throw new StlError(
          `${box.box} dans une branche parallèle, après ${blocking.type === "edge" ? "un front" : "une autre boîte"} : pas générable en LIST. Sépare-les en deux rungs.`,
        );
      const terms = before.filter((e) => !alwaysTrue(e));
      for (const t of terms) this.term(t, "U");
      if (BOX_SPECS[box.box].instance) this.instanceBox(box, terms.length > 0, false);
      else this.transferBox(box, terms.length > 0, null);
    }
  }

  rung(rung: Rung) {
    if (rung.comment !== undefined) this.emit(...rung.comment.split("\n").map((l) => `// ${l}`.trimEnd()));
    this.branchBoxes(rung.condition);
    let items = rung.condition.type === "series" ? rung.condition.items : [rung.condition];
    // Sans bobine, la logique après la dernière boîte de la ligne principale ne sert à rien.
    if (rung.outputs.length === 0) {
      const lastBox = items.map((item) => item.type === "box").lastIndexOf(true);
      items = items.slice(0, lastBox + 1);
    }
    let hasIncoming = false;
    items.forEach((item, i) => {
      const last = i === items.length - 1;
      if (item.type !== "box") {
        if (alwaysTrue(item)) return;
        this.term(item, "U");
        hasIncoming = true;
        return;
      }
      const continues = !last ? "logic" : rung.outputs.length > 0 ? "outputs" : null;
      if (BOX_SPECS[item.box].instance) {
        this.instanceBox(item, hasIncoming, continues !== null);
        hasIncoming = continues !== null;
      } else {
        this.transferBox(item, hasIncoming, continues);
        hasIncoming = continues !== null;
      }
    });
    // Condition toujours passante (ex. MOVE en parallèle seuls) : RLO à 1 pour les bobines.
    if (!hasIncoming && rung.outputs.length > 0) this.emit("SET");
    this.outputs(rung.outputs);
  }

  outputs(outputs: Output[]) {
    for (const o of outputs) {
      if (o.kind === "COIL") this.emit(line("=", o.operand.text));
      else if (o.kind === "SET") this.emit(line("S", o.operand.text));
      else if (o.kind === "RESET") this.emit(line("R", o.operand.text));
      else this.emit("NOT", line("=", o.operand.text), "NOT");
    }
  }
}

export function ladderToStl(program: LadProgram, ctx: StlContext): StlResult {
  const g = new Generator(ctx);
  // En-têtes « NETWORK » dès qu'il y a plusieurs réseaux ou un titre : l'export .awl les reprend.
  const headers = program.networks.length > 1 || program.networks.some((n) => n.title || n.comment);
  try {
    program.networks.forEach((network, n) => {
      if (n > 0) g.emit("");
      if (headers) g.emit("NETWORK", `TITLE = ${network.title ?? ""}`.trimEnd());
      if (network.comment !== undefined)
        g.emit(...network.comment.split("\n").map((l) => `// ${l}`.trimEnd()));
      network.rungs.forEach((rung, r) => {
        if (r > 0) g.emit("");
        g.rung(rung);
      });
    });
  } catch (err) {
    if (err instanceof StlError) return { ok: false, error: `LIST : ${err.message}` };
    throw err;
  }
  const de = `${g.lines.join("\n")}\n`;
  return { ok: true, stl: convertStl(de, "DE", ctx.mnemonic), warnings: [...new Set(g.warnings)] };
}
