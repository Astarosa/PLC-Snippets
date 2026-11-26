import { BOX_SPECS, type Expr, type LadProgram, type Operand, type Value } from "./ast";
import { powerKey } from "./layout";

/*
 * Simulation d'un programme LADDER, cycle par cycle, comme une CPU :
 * les réseaux sont exécutés dans l'ordre, chaque rung lit l'état des variables au
 * moment où il s'exécute et écrit ses bobines immédiatement.
 *
 * Les variables sont repérées par leur texte d'opérande (`"KM1"`, `#Tempo.Q`, `%I0.0`).
 * Les temporisations et compteurs écrivent les membres de leur instance
 * (`"T_Capteur".Q`, `.ET`, `#Compteur.CV`…), lisibles ailleurs dans le programme.
 */

export type SimValue = boolean | number;

/** Mémoire interne d'une instance de temporisation ou de compteur. */
interface InstanceState {
  /** Entrée au cycle précédent (fronts). */
  lastIn: boolean;
  lastCd?: boolean;
  /** Temporisation : instant du démarrage, temps accumulé (TONR). */
  start?: number;
  acc?: number;
  /** TP : impulsion en cours. */
  pulse?: boolean;
}

export interface SimState {
  values: Map<string, SimValue>;
  instances: Map<string, InstanceState>;
  /** Temps du dernier cycle, en ms. */
  now: number;
}

/** Courant à l'entrée et à la sortie de chaque élément, par réseau : clé « rung:chemin ». */
export type PowerFlow = Map<string, { in: boolean; out: boolean }>[];

export const flowKey = powerKey;

export const emptySimState = (): SimState => ({ values: new Map(), instances: new Map(), now: 0 });

/** Nom normalisé d'un opérande : espaces retirés hors guillemets. */
export function operandKey(text: string): string {
  let out = "";
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    if (quoted || !/\s/.test(c)) out += c;
  }
  return out;
}

/** Durée TIA (T#1M30S, T#500MS, T#2.5S…) en ms, ou null. */
export function parseDuration(text: string): number | null {
  const m = /^(?:T|TIME)#(-?)(.+)$/i.exec(text.trim());
  if (!m) return null;
  const units: Record<string, number> = { D: 86_400_000, H: 3_600_000, M: 60_000, S: 1000, MS: 1 };
  let total = 0;
  let rest = m[2].replace(/_/g, "").toUpperCase();
  while (rest.length > 0) {
    const part = /^(\d+(?:\.\d+)?)(MS|D|H|M|S)/.exec(rest);
    if (!part) return null;
    total += Number(part[1]) * units[part[2]];
    rest = rest.slice(part[0].length);
  }
  return m[1] ? -total : total;
}

/** Constante TIA : TRUE/FALSE, entiers (16#, 2#, 8#, INT#…), réels, durées. */
export function parseLiteral(text: string): SimValue | null {
  const t = text.trim();
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  const duration = parseDuration(t);
  if (duration !== null) return duration;
  const typed = /^[A-Z]+#(.+)$/i.exec(t);
  const body = typed && !/^(16|8|2)#/.test(t) ? typed[1] : t;
  const based = /^(16|8|2)#([0-9A-F_]+)$/i.exec(body);
  if (based) return Number.parseInt(based[2].replace(/_/g, ""), Number(based[1]));
  if (/^[+-]?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(body)) return Number(body);
  return null;
}

/** Durée affichée façon TIA : T#1S_500MS → « T#1.5S ». */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `T#${Math.round(ms)}MS`;
  return `T#${(ms / 1000).toFixed(1).replace(/\.0$/, "")}S`;
}

const asBool = (v: SimValue | undefined) => (typeof v === "number" ? v !== 0 : Boolean(v));
const asNumber = (v: SimValue | undefined) => (typeof v === "boolean" ? (v ? 1 : 0) : (v ?? 0));

class Scan {
  constructor(
    private readonly state: SimState,
    private readonly flow: Map<string, { in: boolean; out: boolean }>,
    private readonly rung: number,
  ) {}

  read(op: Operand): SimValue | undefined {
    return this.state.values.get(operandKey(op.text));
  }
  value(v: Value): SimValue {
    if (v.kind === "literal") return parseLiteral(v.text) ?? 0;
    return this.read(v) ?? 0;
  }
  write(op: Operand | Value | undefined, value: SimValue) {
    if (!op || op.kind === "literal") return;
    this.state.values.set(operandKey(op.text), value);
  }
  member(instance: Operand | null, name: string, value: SimValue) {
    if (instance) this.state.values.set(`${operandKey(instance.text)}.${name}`, value);
  }
  instance(op: Operand | null, path: number[]): InstanceState {
    const key = op ? operandKey(op.text) : `@${this.rung}:${path.join(".")}`;
    let s = this.state.instances.get(key);
    if (!s) {
      s = { lastIn: false };
      this.state.instances.set(key, s);
    }
    return s;
  }

  eval(expr: Expr, power: boolean, path: number[]): boolean {
    const out = this.evalInner(expr, power, path);
    this.flow.set(flowKey(this.rung, path), { in: power, out });
    return out;
  }

  private evalInner(expr: Expr, power: boolean, path: number[]): boolean {
    switch (expr.type) {
      case "contact": {
        const on = asBool(this.read(expr.operand));
        return power && (expr.kind === "NO" ? on : !on);
      }
      case "edge": {
        const on = asBool(this.read(expr.operand));
        const memory = asBool(this.read(expr.memory));
        this.write(expr.memory, on);
        return power && (expr.kind === "P" ? on && !memory : !on && memory);
      }
      case "compare": {
        const a = asNumber(this.value(expr.left));
        const b = asNumber(this.value(expr.right));
        const ok = { "==": a === b, "<>": a !== b, ">": a > b, "<": a < b, ">=": a >= b, "<=": a <= b }[
          expr.op
        ];
        return power && ok;
      }
      case "series": {
        let p = power;
        expr.items.forEach((item, i) => {
          p = this.eval(item, p, [...path, i]);
        });
        return p;
      }
      case "parallel": {
        let any = false;
        expr.branches.forEach((branch, i) => {
          if (this.eval(branch, power, [...path, i])) any = true;
        });
        return any;
      }
      case "box":
        return this.box(expr, power, path);
    }
  }

  private box(expr: Extract<Expr, { type: "box" }>, power: boolean, path: number[]): boolean {
    const p = (name: string) => expr.params[name];
    const num = (name: string) => (p(name) ? asNumber(this.value(p(name))) : 0);
    const bool = (name: string) => (p(name) ? asBool(this.value(p(name))) : false);
    const now = this.state.now;
    const inst = this.instance(expr.instance, path);
    switch (expr.box) {
      case "TON":
      case "TOF":
      case "TP":
      case "TONR": {
        const pt = Math.max(0, num("PT"));
        const rising = power && !inst.lastIn;
        const falling = !power && inst.lastIn;
        let q = false;
        let et = 0;
        if (expr.box === "TON") {
          if (rising) inst.start = now;
          et = power ? Math.min(pt, now - (inst.start ?? now)) : 0;
          q = power && et >= pt;
        } else if (expr.box === "TOF") {
          if (falling) inst.start = now;
          et = power ? 0 : Math.min(pt, now - (inst.start ?? now - pt));
          q = power || et < pt;
        } else if (expr.box === "TP") {
          if (rising && !inst.pulse) {
            inst.pulse = true;
            inst.start = now;
          }
          if (inst.pulse) {
            et = Math.min(pt, now - (inst.start ?? now));
            if (et >= pt) inst.pulse = false;
          } else et = power ? pt : 0;
          q = Boolean(inst.pulse);
        } else {
          if (bool("R")) inst.acc = 0;
          if (rising) inst.start = now;
          const running = power ? now - (inst.start ?? now) : 0;
          if (falling) inst.acc = Math.min(pt, (inst.acc ?? 0) + (now - (inst.start ?? now)));
          et = Math.min(pt, (inst.acc ?? 0) + running);
          q = et >= pt;
        }
        inst.lastIn = power;
        this.member(expr.instance, "IN", power);
        this.member(expr.instance, "PT", pt);
        this.member(expr.instance, "Q", q);
        this.member(expr.instance, "ET", et);
        this.write(p("ET"), et);
        return q;
      }
      case "CTU":
      case "CTD":
      case "CTUD": {
        const pv = num("PV");
        const key = `${expr.instance ? operandKey(expr.instance.text) : "@"}.CV`;
        let cv = asNumber(this.state.values.get(key));
        const cu = expr.box === "CTD" ? false : power;
        const cd = expr.box === "CTD" ? power : bool("CD");
        if (cu && !inst.lastIn) cv++;
        if (cd && !(inst.lastCd ?? false)) cv--;
        if (expr.box !== "CTU" && bool("LD")) cv = pv;
        if (expr.box !== "CTD" && bool("R")) cv = 0;
        cv = Math.max(-32768, Math.min(32767, cv));
        inst.lastIn = cu;
        inst.lastCd = cd;
        const qu = cv >= pv;
        const qd = cv <= 0;
        this.member(expr.instance, "CV", cv);
        this.state.values.set(key, cv);
        if (expr.box === "CTUD") {
          this.member(expr.instance, "QU", qu);
          this.member(expr.instance, "QD", qd);
          this.write(p("QD"), qd);
        } else this.member(expr.instance, "Q", expr.box === "CTU" ? qu : qd);
        this.write(p("CV"), cv);
        return expr.box === "CTD" ? qd : qu;
      }
      case "MOVE":
        if (power) this.write(p("OUT"), this.value(p("IN") ?? { kind: "literal", text: "0" }));
        return power;
      case "ADD":
      case "SUB":
      case "MUL":
      case "DIV": {
        if (!power) return false;
        const a = num("IN1");
        const b = num("IN2");
        if (expr.box === "DIV" && b === 0) return false;
        const r = { ADD: a + b, SUB: a - b, MUL: a * b, DIV: a / b }[expr.box];
        this.write(p("OUT"), Number.isInteger(a) && Number.isInteger(b) ? Math.trunc(r) : r);
        return true;
      }
    }
  }
}

/** Un cycle automate à l'instant `now` (ms). Rend le courant dans chaque élément. */
export function scan(program: LadProgram, state: SimState, now: number): PowerFlow {
  state.now = now;
  return program.networks.map((network) => {
    const flow = new Map<string, { in: boolean; out: boolean }>();
    network.rungs.forEach((rung, r) => {
      const s = new Scan(state, flow, r);
      const rlo = s.eval(rung.condition, true, []);
      rung.outputs.forEach((o, i) => {
        flow.set(`${r}:o${i}`, { in: rlo, out: rlo });
        if (o.kind === "COIL") s.write(o.operand, rlo);
        else if (o.kind === "NCOIL") s.write(o.operand, !rlo);
        else if (rlo) s.write(o.operand, o.kind === "SET");
      });
    });
    return flow;
  });
}

export type SimKind = "bool" | "number";

export interface SimVariable {
  key: string;
  label: string;
  kind: SimKind;
  /** Écrite par le programme (bobine, sortie de boîte, bit de front) : non forçable à la main. */
  written: boolean;
}

/**
 * Variables du programme, pour le pupitre de simulation : les entrées (lues seulement)
 * se forcent à la main, les autres s'affichent.
 */
export function simVariables(program: LadProgram): SimVariable[] {
  const vars = new Map<string, SimVariable>();
  const add = (op: Value | null | undefined, kind: SimKind, written = false) => {
    if (!op || op.kind === "literal") return;
    const key = operandKey(op.text);
    const prev = vars.get(key);
    vars.set(key, {
      key,
      label: op.text,
      kind: prev?.kind === "number" ? "number" : kind,
      written: (prev?.written ?? false) || written,
    });
  };
  const visit = (e: Expr) => {
    switch (e.type) {
      case "contact":
        add(e.operand, "bool");
        return;
      case "edge":
        add(e.operand, "bool");
        add(e.memory, "bool", true);
        return;
      case "compare":
        add(e.left, "number");
        add(e.right, "number");
        return;
      case "series":
        e.items.forEach(visit);
        return;
      case "parallel":
        e.branches.forEach(visit);
        return;
      case "box": {
        const spec = BOX_SPECS[e.box];
        for (const [pin, v] of Object.entries(e.params)) {
          const out = spec.outputs.includes(pin) || pin === "OUT";
          const bool = ["R", "LD", "CD", "QD"].includes(pin);
          add(v, bool ? "bool" : "number", out);
        }
      }
    }
  };
  for (const network of program.networks)
    for (const rung of network.rungs) {
      visit(rung.condition);
      for (const o of rung.outputs) add(o.operand, "bool", true);
    }
  // Membres d'instance (#Tempo.Q, "T".ET…) : calculés par la boîte, affichés au pupitre.
  const instances = new Set<string>();
  const collect = (e: Expr) => {
    if (e.type === "box" && e.instance) {
      instances.add(operandKey(e.instance.text));
      const timer = ["TON", "TOF", "TP", "TONR"].includes(e.box);
      const members = timer ? ["Q", "ET"] : e.box === "CTUD" ? ["QU", "QD", "CV"] : ["Q", "CV"];
      for (const m of members) {
        const key = `${operandKey(e.instance.text)}.${m}`;
        if (!vars.has(key))
          vars.set(key, {
            key,
            label: `${e.instance.text}.${m}`,
            kind: m === "ET" || m === "CV" ? "number" : "bool",
            written: true,
          });
      }
    }
    if (e.type === "series") e.items.forEach(collect);
    if (e.type === "parallel") e.branches.forEach(collect);
  };
  for (const network of program.networks) for (const rung of network.rungs) collect(rung.condition);
  for (const v of vars.values()) if ([...instances].some((i) => v.key.startsWith(`${i}.`))) v.written = true;
  return [...vars.values()];
}
