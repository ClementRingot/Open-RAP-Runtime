/**
 * Lexer of behavior definitions (BDEF).
 *
 * BDEF keywords are case-insensitive and are not reserved: every keyword token also belongs to the
 * `Name` category, so a keyword can be used wherever a name is expected (an entity alias called
 * `Data`, a field called `Mode`…).
 */

import { createToken, Lexer, type TokenType } from "chevrotain";

/** Every token except `;`, `{` and `}`: used to skip unknown statements. */
export const Any = createToken({ name: "Any", pattern: Lexer.NA });
export const Name = createToken({ name: "Name", pattern: Lexer.NA, categories: [Any] });

export const WhiteSpace = createToken({ name: "WhiteSpace", pattern: /\s+/, group: Lexer.SKIPPED });
export const LineComment = createToken({ name: "LineComment", pattern: /\/\/[^\r\n]*/, group: Lexer.SKIPPED });
export const BlockComment = createToken({ name: "BlockComment", pattern: /\/\*[\s\S]*?\*\//, group: Lexer.SKIPPED });

export const Identifier = createToken({
  name: "Identifier",
  // optional namespace prefix (/DMO/), then a name; `$self` is an identifier too
  pattern: /(?:\/[A-Za-z0-9_]+\/)?[A-Za-z_$%][A-Za-z0-9_$%]*/,
  categories: [Name],
});

export const StringLiteral = createToken({ name: "StringLiteral", pattern: /'(?:[^'\r\n]|'')*'/, categories: [Any] });
export const Integer = createToken({ name: "Integer", pattern: /\d+/, categories: [Any] });

export const LCurly = createToken({ name: "LCurly", pattern: /\{/ });
export const RCurly = createToken({ name: "RCurly", pattern: /\}/ });
export const Semicolon = createToken({ name: "Semicolon", pattern: /;/ });
export const LParen = createToken({ name: "LParen", pattern: /\(/, categories: [Any] });
export const RParen = createToken({ name: "RParen", pattern: /\)/, categories: [Any] });
export const LBracket = createToken({ name: "LBracket", pattern: /\[/, categories: [Any] });
export const RBracket = createToken({ name: "RBracket", pattern: /\]/, categories: [Any] });
export const Comma = createToken({ name: "Comma", pattern: /,/, categories: [Any] });
export const Colon = createToken({ name: "Colon", pattern: /:/, categories: [Any] });
export const Equals = createToken({ name: "Equals", pattern: /=/, categories: [Any] });
export const DotDot = createToken({ name: "DotDot", pattern: /\.\./, categories: [Any] });
export const Dot = createToken({ name: "Dot", pattern: /\./, categories: [Any] });
export const Star = createToken({ name: "Star", pattern: /\*/, categories: [Any] });
export const Other = createToken({ name: "Other", pattern: /[~\\\-+<>!?&|^#@]/, categories: [Any] });

const keywordTokens: Array<{ word: string; token: TokenType }> = [];

function keyword(word: string): TokenType {
  const token = createToken({
    name: `K_${word}`,
    pattern: new RegExp(word, "i"),
    longer_alt: Identifier,
    categories: [Name],
  });
  keywordTokens.push({ word, token });
  return token;
}

export const K = {
  abbreviation: keyword("abbreviation"),
  abstract: keyword("abstract"),
  action: keyword("action"),
  additional: keyword("additional"),
  affects: keyword("affects"),
  alias: keyword("alias"),
  association: keyword("association"),
  authorization: keyword("authorization"),
  behavior: keyword("behavior"),
  by: keyword("by"),
  class: keyword("class"),
  control: keyword("control"),
  corresponding: keyword("corresponding"),
  create: keyword("create"),
  define: keyword("define"),
  delete: keyword("delete"),
  dependent: keyword("dependent"),
  determination: keyword("determination"),
  determine: keyword("determine"),
  disabling: keyword("disabling"),
  draft: keyword("draft"),
  early: keyword("early"),
  effects: keyword("effects"),
  entity: keyword("entity"),
  etag: keyword("etag"),
  event: keyword("event"),
  external: keyword("external"),
  extend: keyword("extend"),
  factory: keyword("factory"),
  field: keyword("field"),
  for: keyword("for"),
  foreign: keyword("foreign"),
  function: keyword("function"),
  implementation: keyword("implementation"),
  in: keyword("in"),
  interface: keyword("interface"),
  internal: keyword("internal"),
  late: keyword("late"),
  lock: keyword("lock"),
  managed: keyword("managed"),
  mapping: keyword("mapping"),
  master: keyword("master"),
  messages: keyword("messages"),
  mode: keyword("mode"),
  modify: keyword("modify"),
  numbering: keyword("numbering"),
  on: keyword("on"),
  parameter: keyword("parameter"),
  permissions: keyword("permissions"),
  persistent: keyword("persistent"),
  place: keyword("place"),
  privileged: keyword("privileged"),
  projection: keyword("projection"),
  result: keyword("result"),
  root: keyword("root"),
  save: keyword("save"),
  selective: keyword("selective"),
  side: keyword("side"),
  static: keyword("static"),
  strict: keyword("strict"),
  table: keyword("table"),
  total: keyword("total"),
  unique: keyword("unique"),
  unmanaged: keyword("unmanaged"),
  update: keyword("update"),
  use: keyword("use"),
  validation: keyword("validation"),
  with: keyword("with"),
} as const;

/** Longer keywords first, so that `for` does not shadow `foreign`. */
const sortedKeywords = [...keywordTokens].sort((a, b) => b.word.length - a.word.length).map((k) => k.token);

/** Order matters: comments before `/`, keywords before identifiers, `..` before `.`. */
export const allTokens: TokenType[] = [
  WhiteSpace,
  BlockComment,
  LineComment,
  StringLiteral,
  Integer,
  LCurly,
  RCurly,
  Semicolon,
  LParen,
  RParen,
  LBracket,
  RBracket,
  Comma,
  Colon,
  Equals,
  DotDot,
  Dot,
  Star,
  ...sortedKeywords,
  Identifier,
  Other,
  Name,
  Any,
];

export const bdefLexer = new Lexer(allTokens, { ensureOptimizations: false, positionTracking: "full" });
