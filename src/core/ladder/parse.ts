import {
  BOX_SPECS,
  type BoxKind,
  type CoilKind,
  type CompareOp,
  type ContactKind,
  type EdgeKind,
  type Expr,
  type LadError,
  type LadProgram,
  type Network,
  type Operand,
  type Output,
  type Rung,
  type Value,
} from "./ast";

/*
 * Parseur du DSL LADDER (descente récursive, sans dépendance).
 *
 *   programme := réseau*
 *   réseau    := "network" "titre"? rung+        (le mot-clé est optionnel pour le 1er réseau)
 *   rung      := expr ("->" sortie ("," sortie)*)?  (sans sortie si le rung finit par une boîte)
 *   expr      := terme ("|" terme)*               | = branches en parallèle (OU)
 *   terme     := facteur ("&" facteur)*           & = en série (ET)
 *   facteur   := contact | front | comparateur | boîte | "(" expr ")"
 *   contact   := ("NO" | "NC") opérande
 *   front     := ("P" | "N") opérande MEM=opérande
 *   comparateur := "CMP" valeur ("==" | "<>" | ">" | "<" | ">=" | "<=") valeur
 *   boîte     := (TON | TOF | TP | TONR | CTU | CTD | CTUD) instance param*
 *              | (MOVE | ADD | SUB | MUL | DIV) param*
 *   param     := NOM "=" valeur
 *   sortie    := ("COIL" | "NCOIL" | "SET" | "RESET") opérande
 *   opérande  := "Mnémonique"(.membre)* | #Locale(.membre)* | %I0.0
 *   valeur    := opérande | T#5S | 16#FF | 10 | 2.5 | TRUE | FALSE
 *
 * Les retours à la ligne sont libres ; « // » commente jusqu'à la fin de la ligne.
 */

type TokenKind = "word" | "string" | "local" | "absolute" | "literal" | "symbol" | "eof";

interface Token {
  kind: TokenKind;
  text: string;
  line: number;
  col: number;
}

const MEMBER = String.raw`(?:\.(?:"[^"\n]*"|[A-Za-z_]\w*|\d+))*`;
const PATTERNS: [TokenKind | "skip" | "comment", RegExp][] = [
  ["skip", /^[ \t\r]+/],
  ["comment", /^\/\/[^\n]*/],
  ["string", new RegExp(`^"[^"\\n]*"${MEMBER}`)],
  ["local", new RegExp(`^#[A-Za-z_]\\w*${MEMBER}`)],
  ["absolute", /^%[IQM][XBWD]?\d+(?:\.\d+)?/i],
  ["literal", /^(?:[A-Za-z_]+|\d+)#[\w.:+-]+/], // T#5S, 16#FF, 2#1010, INT#10
  ["symbol", /^(?:->|==|<>|>=|<=|[&|(),=<>])/],
  ["literal", /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/],
  ["word", /^[A-Za-z_]\w*/],
];

class LadSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly col: number,
  ) {
    super(message);
  }
}

interface Comment {
  line: number;
  text: string;
}

function tokenize(source: string): Token[] {
  return lex(source).tokens;
}

function lex(source: string): { tokens: Token[]; comments: Comment[] } {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  let line = 1;
  let col = 1;
  let rest = source;

  while (rest.length > 0) {
    if (rest[0] === "\n") {
      rest = rest.slice(1);
      line++;
      col = 1;
      continue;
    }
    const match = PATTERNS.map(([kind, re]) => ({ kind, m: re.exec(rest) })).find((p) => p.m);
    if (!match?.m) {
      const hint = rest[0] === '"' ? " (guillemet non fermé ?)" : "";
      throw new LadSyntaxError(`Caractère inattendu « ${rest[0]} »${hint}`, line, col);
    }
    const text = match.m[0];
    if (match.kind === "comment") comments.push({ line, text: text.replace(/^\/\/ ?/, "").trimEnd() });
    else if (match.kind !== "skip") tokens.push({ kind: match.kind, text, line, col });
    rest = rest.slice(text.length);
    col += text.length;
  }
  tokens.push({ kind: "eof", text: "fin du texte", line, col });
  return { tokens, comments };
}

const CONTACTS = new Set<string>(["NO", "NC"]);
const EDGES = new Set<string>(["P", "N"]);
const COILS = new Set<string>(["COIL", "NCOIL", "SET", "RESET"]);
const COMPARE_OPS = new Set<string>(["==", "<>", ">", "<", ">=", "<="]);
const isBox = (word: string): word is BoxKind => word in BOX_SPECS;

/** Le rung finit-il par une boîte ? (autorise un rung sans bobine, ex. un MOVE seul) */
function endsWithBox(expr: Expr): boolean {
  if (expr.type === "box") return true;
  if (expr.type === "series") return endsWithBox(expr.items[expr.items.length - 1]);
  return false;
}

class Parser {
  private pos = 0;
  /** Lignes des en-têtes « network » et étendue (lignes) de chaque rung : pour rattacher les commentaires. */
  readonly headers: { network: Network; line: number | null }[] = [];
  readonly spans: { rung: Rung; start: number; end: number }[] = [];
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private fail(token: Token, message: string): never {
    throw new LadSyntaxError(message, token.line, token.col);
  }
  private isSymbol(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === "symbol" && t.text === text;
  }
  private isWord(text: string): boolean {
    const t = this.peek();
    return t.kind === "word" && t.text.toUpperCase() === text.toUpperCase();
  }
  private expectSymbol(text: string, context: string) {
    if (!this.isSymbol(text))
      this.fail(this.peek(), `« ${text} » attendu ${context}, trouvé « ${this.peek().text} »`);
    this.next();
  }

  program(): LadProgram {
    const networks: Network[] = [];
    while (this.peek().kind !== "eof") networks.push(this.network(networks.length === 0));
    if (networks.length === 0) this.fail(this.peek(), "Le schéma est vide : écris au moins un rung");
    return { networks };
  }

  private network(first: boolean): Network {
    let title: string | null = null;
    let headerLine: number | null = null;
    if (this.isWord("network")) {
      headerLine = this.next().line;
      if (this.peek().kind === "string" && /^"[^"]*"$/.test(this.peek().text))
        title = this.next().text.slice(1, -1);
    } else if (!first) {
      this.fail(this.peek(), `« network » ou un nouveau rung attendu, trouvé « ${this.peek().text} »`);
    }
    const rungs: Rung[] = [];
    while (this.peek().kind !== "eof" && !this.isWord("network")) rungs.push(this.rung());
    if (rungs.length === 0)
      this.fail(this.peek(), "Réseau vide : il faut au moins un rung (contacts -> bobine)");
    const network: Network = { title, rungs };
    this.headers.push({ network, line: headerLine });
    return network;
  }

  private rung(): Rung {
    const start = this.peek().line;
    const rung = this.rungBody();
    this.spans.push({ rung, start, end: this.tokens[this.pos - 1].line });
    return rung;
  }

  private rungBody(): Rung {
    const condition = this.expr();
    if (!this.isSymbol("->")) {
      if (endsWithBox(condition)) return { condition, outputs: [] };
      this.fail(this.peek(), `« -> » attendu avant la bobine, trouvé « ${this.peek().text} »`);
    }
    this.next();
    const outputs = [this.output()];
    while (this.isSymbol(",")) {
      this.next();
      outputs.push(this.output());
    }
    return { condition, outputs };
  }

  private expr(): Expr {
    const branches = [this.term()];
    while (this.isSymbol("|")) {
      this.next();
      branches.push(this.term());
    }
    return branches.length === 1 ? branches[0] : { type: "parallel", branches };
  }

  private term(): Expr {
    const items = [this.factor()];
    while (this.isSymbol("&")) {
      this.next();
      items.push(this.factor());
    }
    return items.length === 1 ? items[0] : { type: "series", items };
  }

  private factor(): Expr {
    const t = this.peek();
    if (this.isSymbol("(")) {
      this.next();
      const inner = this.expr();
      this.expectSymbol(")", "pour fermer la parenthèse");
      return inner;
    }
    if (t.kind !== "word") this.fail(t, `Élément attendu (NO, NC, CMP, TON…), trouvé « ${t.text} »`);

    const word = t.text.toUpperCase();
    if (CONTACTS.has(word)) {
      this.next();
      return { type: "contact", kind: word as ContactKind, operand: this.operand(word) };
    }
    if (EDGES.has(word)) {
      this.next();
      const operand = this.operand(word);
      const params = this.params(t, ["MEM"]);
      if (!params.MEM) this.fail(t, `Front ${word} : bit mémoire de front manquant (MEM="Mem_Front")`);
      if (params.MEM.kind === "literal")
        this.fail(t, `Front ${word} : MEM doit être une variable, pas une constante`);
      return { type: "edge", kind: word as EdgeKind, operand, memory: params.MEM };
    }
    if (word === "CMP") {
      this.next();
      const left = this.value("CMP");
      const op = this.peek();
      if (op.kind !== "symbol" || !COMPARE_OPS.has(op.text)) {
        this.fail(op, `Comparateur attendu (==, <>, >, <, >=, <=), trouvé « ${op.text} »`);
      }
      this.next();
      return { type: "compare", op: op.text as CompareOp, left, right: this.value(`CMP ${op.text}`) };
    }
    if (isBox(word)) {
      this.next();
      return this.box(t, word);
    }
    if (COILS.has(word)) this.fail(t, `Bobine ${word} dans la condition : il manque « -> » avant`);
    this.fail(t, `Élément inconnu « ${t.text} » (attendu : NO, NC, P, N, CMP, TON, CTU, MOVE…)`);
  }

  private box(at: Token, box: BoxKind): Expr {
    const spec = BOX_SPECS[box];
    let instance: Operand | null = null;
    if (spec.instance) {
      const t = this.peek();
      if (t.kind !== "string" && t.kind !== "local") {
        this.fail(
          t,
          `${box} : instance attendue ("T_Defaut" pour un DB d'instance, #Tempo en multi-instance)`,
        );
      }
      instance = this.operand(box);
    }
    const params = this.params(at, [...spec.inputs, ...spec.outputs]);
    for (const name of spec.required) {
      if (!params[name]) this.fail(at, `${box} : paramètre ${name} manquant (ex. ${name}=${example(name)})`);
    }
    for (const name of spec.outputs) {
      if (params[name]?.kind === "literal")
        this.fail(at, `${box} : la sortie ${name} doit être une variable`);
    }
    return { type: "box", box, instance, params };
  }

  /** Lit les `NOM=valeur` qui suivent un élément. */
  private params(owner: Token, allowed: string[]): Record<string, Value> {
    const params: Record<string, Value> = {};
    while (this.peek().kind === "word" && this.isSymbol("=", 1)) {
      const nameToken = this.next();
      const name = nameToken.text.toUpperCase();
      if (!allowed.includes(name)) {
        this.fail(
          nameToken,
          `${owner.text.toUpperCase()} n'a pas de paramètre ${name} (possibles : ${allowed.join(", ")})`,
        );
      }
      if (params[name]) this.fail(nameToken, `Paramètre ${name} donné deux fois`);
      this.next(); // =
      params[name] = this.value(name);
    }
    return params;
  }

  private value(owner: string): Value {
    const t = this.peek();
    if (t.kind === "literal") {
      this.next();
      return { kind: "literal", text: t.text.toUpperCase() };
    }
    if (t.kind === "word" && /^(TRUE|FALSE)$/i.test(t.text)) {
      this.next();
      return { kind: "literal", text: t.text.toUpperCase() };
    }
    return this.operand(owner);
  }

  private output(): Output {
    const t = this.peek();
    const word = t.kind === "word" ? t.text.toUpperCase() : "";
    if (!COILS.has(word)) this.fail(t, `Bobine attendue (COIL, NCOIL, SET, RESET), trouvé « ${t.text} »`);
    this.next();
    return { kind: word as CoilKind, operand: this.operand(word) };
  }

  private operand(owner: string): Operand {
    const t = this.peek();
    if (t.kind === "string" || t.kind === "local" || t.kind === "absolute") {
      this.next();
      const kind = t.kind === "string" ? "global" : t.kind;
      return { kind, text: t.kind === "absolute" ? t.text.toUpperCase() : t.text };
    }
    this.fail(t, `Opérande attendu après ${owner} : "Mnémonique", #Locale ou %I0.0`);
  }
}

function example(param: string): string {
  if (param === "PT") return "T#5S";
  if (param === "PV") return "10";
  if (param === "OUT") return '"Consigne"';
  return '"Valeur"';
}

export type LadParseResult = { ok: true; program: LadProgram } | { ok: false; error: LadError };

/** Rattache chaque commentaire au rung qui le contient ou le suit, ou au réseau dont il précède l'en-tête. */
function attachComments(parser: Parser, comments: Comment[]) {
  const append = (target: { comment?: string }, text: string) => {
    target.comment = target.comment === undefined ? text : `${target.comment}\n${text}`;
  };
  for (const c of comments) {
    const inside = parser.spans.find((s) => s.start <= c.line && c.line <= s.end);
    if (inside) {
      append(inside.rung, c.text);
      continue;
    }
    const header = parser.headers.find((h) => h.line === c.line);
    if (header) {
      append(header.network, c.text);
      continue;
    }
    const nextHeader = parser.headers
      .filter((h) => h.line !== null && h.line > c.line)
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0))[0];
    const nextRung = parser.spans.filter((s) => s.start > c.line).sort((a, b) => a.start - b.start)[0];
    if (nextHeader && (!nextRung || (nextHeader.line ?? 0) < nextRung.start))
      append(nextHeader.network, c.text);
    else if (nextRung) append(nextRung.rung, c.text);
    else if (parser.spans.length > 0) append(parser.spans[parser.spans.length - 1].rung, c.text);
  }
}

export function parseLadder(source: string): LadParseResult {
  try {
    const { tokens, comments } = lex(source);
    const parser = new Parser(tokens);
    const program = parser.program();
    attachComments(parser, comments);
    return { ok: true, program };
  } catch (e) {
    if (e instanceof LadSyntaxError) {
      return { ok: false, error: { message: e.message, line: e.line, col: e.col } };
    }
    throw e;
  }
}

export type ValueParseResult = { ok: true; value: Value } | { ok: false; error: string };

/** Saisie « nue » : ni "…", ni #locale, ni %adresse, ni constante (10, T#5S, TRUE…). */
function isBareName(text: string): boolean {
  if (/^["#%]/.test(text)) return false;
  if (/^[+-]?\d/.test(text)) return false;
  if (/^[A-Za-z_]+#/.test(text)) return false;
  return !/^(TRUE|FALSE)$/i.test(text);
}

/**
 * Lit un opérande ou une valeur saisi dans l'inspecteur de l'éditeur visuel.
 * Les guillemets sont facultatifs pour les variables API :
 *   Moteur → "Moteur"   ·   Mot clé → "Mot clé"   ·   DB_Ligne.Marche → "DB_Ligne".Marche
 */
export function parseValueText(input: string, allowLiteral: boolean): ValueParseResult {
  const text = input.trim();
  if (!text) return { ok: false, error: "Valeur vide" };
  let source = text;
  if (isBareName(text)) {
    const dot = text.indexOf(".");
    source = dot > 0 ? `"${text.slice(0, dot).trim()}"${text.slice(dot)}` : `"${text}"`;
  }
  let tokens: Token[];
  try {
    tokens = tokenize(source).filter((t) => t.kind !== "eof");
  } catch {
    return { ok: false, error: "Caractère invalide (guillemet non fermé ?)" };
  }
  const t = tokens[0];
  if (tokens.length !== 1) return { ok: false, error: "Une seule variable ou valeur attendue" };
  if (t.kind === "string") return { ok: true, value: { kind: "global", text: t.text } };
  if (t.kind === "local") return { ok: true, value: { kind: "local", text: t.text } };
  if (t.kind === "absolute") return { ok: true, value: { kind: "absolute", text: t.text.toUpperCase() } };
  const literal = t.kind === "literal" || (t.kind === "word" && /^(TRUE|FALSE)$/i.test(t.text));
  if (literal && allowLiteral) return { ok: true, value: { kind: "literal", text: t.text.toUpperCase() } };
  if (literal) return { ok: false, error: "Une variable est attendue ici, pas une constante" };
  return { ok: false, error: "Attendu : un nom de variable, #Locale, %I0.0 ou une constante" };
}

/**
 * Texte proposé à l'édition : une variable API s'affiche sans guillemets quand
 * la relecture redonne exactement le même opérande ("Moteur" → Moteur).
 */
export function toEditableText(text: string): string {
  const m = /^"([^"]*)"(.*)$/.exec(text);
  if (!m) return text;
  const [, name, members] = m;
  const bare = `${name}${members}`;
  if (!name.trim() || name.includes(".") || name !== name.trim() || !isBareName(bare)) return text;
  const back = parseValueText(bare, false);
  return back.ok && back.value.text === text ? bare : text;
}

export const formatLadError = (e: LadError) => `ligne ${e.line}, colonne ${e.col} : ${e.message}`;
