import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/* Coloration syntaxique simple (tokenizer ligne par ligne), suffisante pour lire et écrire du code. */

const SCL_KEYWORDS = new Set(
  (
    "IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL " +
    "END_REPEAT EXIT CONTINUE RETURN GOTO REGION END_REGION AND OR XOR NOT MOD " +
    "VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_TEMP VAR_STAT VAR_CONSTANT CONSTANT END_VAR RETAIN NON_RETAIN " +
    "FUNCTION FUNCTION_BLOCK END_FUNCTION END_FUNCTION_BLOCK DATA_BLOCK END_DATA_BLOCK TYPE END_TYPE " +
    "STRUCT END_STRUCT BEGIN VERSION ARRAY"
  ).split(" "),
);
const SCL_TYPES = new Set(
  (
    "BOOL BYTE WORD DWORD LWORD SINT INT DINT LINT USINT UINT UDINT ULINT REAL LREAL TIME LTIME DATE " +
    "TIME_OF_DAY TOD DTL DT CHAR WCHAR STRING WSTRING VARIANT TON TOF TP TONR CTU CTD CTUD R_TRIG F_TRIG " +
    "TON_TIME TOF_TIME TP_TIME TONR_TIME IEC_TIMER IEC_COUNTER"
  ).split(" "),
);
const SCL_ATOMS = new Set(["TRUE", "FALSE", "NULL"]);

interface SclState {
  inBlockComment: boolean;
}

const sclParser: StreamParser<SclState> = {
  name: "scl",
  startState: () => ({ inBlockComment: false }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.skipTo("*)")) {
        stream.pos += 2;
        state.inBlockComment = false;
      } else stream.skipToEnd();
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("(*")) {
      state.inBlockComment = true;
      return "comment";
    }
    if (stream.match(/^"[^"]*"?/)) return "globalTag";
    if (stream.match(/^'[^']*'?/)) return "string";
    if (stream.match(/^#[A-Za-z_]\w*/)) return "variableName";
    if (stream.match(/^[A-Za-z]+#[\w.:+-]+/)) return "number"; // T#5S, 16#FF, DTL#…
    if (stream.match(/^\d+(\.\d+)?([eE][-+]?\d+)?/)) return "number";
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current().toUpperCase();
      if (SCL_KEYWORDS.has(word)) return "keyword";
      if (SCL_TYPES.has(word)) return "typeName";
      if (SCL_ATOMS.has(word)) return "atom";
      return null;
    }
    if (stream.match(/^(:=|<=|>=|<>|=>|[-+*/=<>])/)) return "operator";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "//", block: { open: "(*", close: "*)" } } },
  tokenTable: { globalTag: tags.special(tags.variableName) },
};

const LAD_KEYWORDS = new Set(["network"]);
const LAD_ELEMENTS = new Set(
  "NO NC P N CMP COIL NCOIL SET RESET TON TOF TP TONR CTU CTD CTUD MOVE ADD SUB MUL DIV".split(" "),
);

const ladParser: StreamParser<null> = {
  name: "lad",
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^"[^"]*"?/)) return "globalTag";
    if (stream.match(/^#[A-Za-z_]\w*/)) return "variableName";
    if (stream.match(/^[A-Za-z]+#[\w.:+-]+/)) return "number";
    if (stream.match(/^[+-]?\d+(\.\d+)?/)) return "number";
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current();
      if (LAD_KEYWORDS.has(word)) return "keyword";
      if (/^(TRUE|FALSE)$/i.test(word)) return "atom";
      if (LAD_ELEMENTS.has(word.toUpperCase())) return "typeName";
      return "propertyName"; // paramètres de boîte : IN=, PT=…
    }
    if (stream.match(/^(->|==|<>|>=|<=|[&|=<>,])/)) return "operator";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "//" } },
  tokenTable: { globalTag: tags.special(tags.variableName) },
};

interface StlState {
  /** true tant que l'instruction de la ligne n'a pas été lue */
  expectInstruction: boolean;
}

const stlParser: StreamParser<StlState> = {
  name: "stl",
  startState: () => ({ expectInstruction: true }),
  token(stream, state) {
    if (stream.sol()) state.expectInstruction = true;
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (state.expectInstruction && stream.match(/^[A-Za-z_]\w{0,3}:/)) return "labelName";
    if (state.expectInstruction && stream.match(/^(NETWORK|TITLE)\b/i)) {
      stream.skipToEnd();
      return "heading";
    }
    if (state.expectInstruction && stream.match(/^[^\s;/]+/)) {
      state.expectInstruction = false;
      return "keyword";
    }
    if (stream.match(/^"[^"]*"?/)) return "globalTag";
    if (stream.match(/^#[A-Za-z_]\w*(\.[A-Za-z_]\w*)*/)) return "variableName";
    if (stream.match(/^[A-Za-z]+#[\w.:+-]+/)) return "number";
    if (
      stream.match(
        /^%?(PEB|PEW|PED|PAB|PAW|PAD|PIB|PIW|PID|PQB|PQW|PQD|EB|EW|ED|AB|AW|AD|IB|IW|ID|QB|QW|QD|MB|MW|MD|DBX|DBB|DBW|DBD|E|A|I|Q|M|T|Z|C|DB)\s*\d+(\.\d+)?/i,
      )
    )
      return "typeName";
    if (stream.match(/^[+-]?\d+(\.\d+)?/)) return "number";
    if (stream.match(/^:=/)) return "operator";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "//" } },
  tokenTable: { globalTag: tags.special(tags.variableName) },
};

export const scl = () => StreamLanguage.define(sclParser);
export const stl = () => StreamLanguage.define(stlParser);
export const lad = () => StreamLanguage.define(ladParser);
