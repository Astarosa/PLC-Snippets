import type {
  CoilKind,
  ContactKind,
  Expr,
  LadError,
  LadProgram,
  Network,
  Operand,
  Output,
  Rung,
} from "./ast";

/*
 * Parseur du DSL LADDER (descente récursive, sans dépendance).
 *
 *   programme := réseau*
 *   réseau    := "network" "titre"? rung+        (le mot-clé est optionnel pour le 1er réseau)
 *   rung      := expr "->" sortie ("," sortie)*
 *   expr      := terme ("|" terme)*               | = branches en parallèle (OU)
 *   terme     := facteur ("&" facteur)*           & = contacts en série (ET)
 *   facteur   := contact | "(" expr ")"
 *   contact   := ("NO" | "NC") opérande
 *   sortie    := ("COIL" | "NCOIL" | "SET" | "RESET") opérande
 *   opérande  := "Mnémonique"(.membre)* | #Locale(.membre)* | %I0.0
 *
 * Les retours à la ligne sont libres ; « // » commente jusqu'à la fin de la ligne.
 */

type TokenKind = "word" | "string" | "local" | "absolute" | "symbol" | "eof";

interface Token {
  kind: TokenKind;
  text: string;
  line: number;
  col: number;
}

const MEMBER = String.raw`(?:\.(?:"[^"\n]*"|[A-Za-z_]\w*|\d+))*`;
const PATTERNS: [TokenKind | "skip", RegExp][] = [
  ["skip", /^(?:[ \t\r]+|\/\/[^\n]*)/],
  ["string", new RegExp(`^"[^"\\n]*"${MEMBER}`)],
  ["local", new RegExp(`^#[A-Za-z_]\\w*${MEMBER}`)],
  ["absolute", /^%[IQM][XBWD]?\d+(?:\.\d+)?/i],
  ["symbol", /^(?:->|[&|(),])/],
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

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
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
    if (match.kind !== "skip") tokens.push({ kind: match.kind, text, line, col });
    rest = rest.slice(text.length);
    col += text.length;
  }
  tokens.push({ kind: "eof", text: "fin du texte", line, col });
  return tokens;
}

const CONTACTS = new Set<string>(["NO", "NC"]);
const COILS = new Set<string>(["COIL", "NCOIL", "SET", "RESET"]);
/** Reconnus mais pas encore gérés : message explicite plutôt qu'« inconnu ». */
const LATER = new Set([
  "P",
  "N",
  "TON",
  "TOF",
  "TP",
  "TONR",
  "CTU",
  "CTD",
  "CTUD",
  "MOVE",
  "CMP",
  "ADD",
  "SUB",
  "MUL",
  "DIV",
]);

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private fail(token: Token, message: string): never {
    throw new LadSyntaxError(message, token.line, token.col);
  }
  private isSymbol(text: string): boolean {
    const t = this.peek();
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
    if (this.isWord("network")) {
      this.next();
      if (this.peek().kind === "string" && /^"[^"]*"$/.test(this.peek().text))
        title = this.next().text.slice(1, -1);
    } else if (!first) {
      this.fail(this.peek(), `« network » ou un nouveau rung attendu, trouvé « ${this.peek().text} »`);
    }
    const rungs: Rung[] = [];
    while (this.peek().kind !== "eof" && !this.isWord("network")) rungs.push(this.rung());
    if (rungs.length === 0)
      this.fail(this.peek(), "Réseau vide : il faut au moins un rung (contacts -> bobine)");
    return { title, rungs };
  }

  private rung(): Rung {
    const condition = this.expr();
    this.expectSymbol("->", "avant la bobine");
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
    if (t.kind === "word") {
      const word = t.text.toUpperCase();
      if (CONTACTS.has(word)) {
        this.next();
        return { type: "contact", kind: word as ContactKind, operand: this.operand(word) };
      }
      if (COILS.has(word)) this.fail(t, `Bobine ${word} dans la condition : il manque « -> » avant`);
      if (LATER.has(word)) this.fail(t, `« ${word} » n'est pas encore géré (boîtes et fronts : étape 5)`);
      this.fail(t, `Élément inconnu « ${t.text} » (attendu : NO, NC ou une parenthèse)`);
    }
    this.fail(t, `Contact attendu (NO ou NC), trouvé « ${t.text} »`);
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

export type LadParseResult = { ok: true; program: LadProgram } | { ok: false; error: LadError };

export function parseLadder(source: string): LadParseResult {
  try {
    return { ok: true, program: new Parser(tokenize(source)).program() };
  } catch (e) {
    if (e instanceof LadSyntaxError) {
      return { ok: false, error: { message: e.message, line: e.line, col: e.col } };
    }
    throw e;
  }
}

export const formatLadError = (e: LadError) => `ligne ${e.line}, colonne ${e.col} : ${e.message}`;
