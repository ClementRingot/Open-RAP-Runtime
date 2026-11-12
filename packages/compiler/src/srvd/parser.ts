/**
 * Chevrotain grammar of service definitions (SRVD): abaplint recognizes the object but does not
 * parse its source.
 *
 *   @EndUserText.label: 'Travel service'
 *   define service ZRT_UI_TRAVEL {
 *     expose ZRT_C_Travel as Travel;
 *   }
 */

import { createToken, EmbeddedActionsParser, Lexer, type IToken } from "chevrotain";
import { setAnnotation, type AnnotationObject, type AnnotationValue, type Annotations } from "@open-rap/model";

const WhiteSpace = createToken({ name: "WhiteSpace", pattern: /\s+/, group: Lexer.SKIPPED });
const LineComment = createToken({ name: "LineComment", pattern: /\/\/[^\r\n]*/, group: Lexer.SKIPPED });
const BlockComment = createToken({ name: "BlockComment", pattern: /\/\*[\s\S]*?\*\//, group: Lexer.SKIPPED });
const StringLiteral = createToken({ name: "StringLiteral", pattern: /'(?:[^'\r\n]|'')*'/ });
const NumberLiteral = createToken({ name: "NumberLiteral", pattern: /-?\d+(?:\.\d+)?/ });
const Name = createToken({ name: "Name", pattern: /(?:\/[A-Za-z0-9_]+\/)?[A-Za-z_][A-Za-z0-9_]*/ });
const At = createToken({ name: "At", pattern: /@/ });
const Hash = createToken({ name: "Hash", pattern: /#/ });
const LCurly = createToken({ name: "LCurly", pattern: /\{/ });
const RCurly = createToken({ name: "RCurly", pattern: /\}/ });
const LBracket = createToken({ name: "LBracket", pattern: /\[/ });
const RBracket = createToken({ name: "RBracket", pattern: /\]/ });
const Semicolon = createToken({ name: "Semicolon", pattern: /;/ });
const Comma = createToken({ name: "Comma", pattern: /,/ });
const Colon = createToken({ name: "Colon", pattern: /:/ });
const Dot = createToken({ name: "Dot", pattern: /\./ });

const tokens = [
  WhiteSpace,
  BlockComment,
  LineComment,
  StringLiteral,
  NumberLiteral,
  Name,
  At,
  Hash,
  LCurly,
  RCurly,
  LBracket,
  RBracket,
  Semicolon,
  Comma,
  Colon,
  Dot,
];

const srvdLexer = new Lexer(tokens, { ensureOptimizations: false, positionTracking: "full" });

export interface ExposeAst {
  entity: string;
  wellFormed?: boolean;
  alias?: string;
  annotations: Annotations;
  line: number;
  column: number;
}

export interface SrvdAst {
  name: string;
  /** False when the statement does not read `define service … { expose …; }`. */
  wellFormed: boolean;
  annotations: Annotations;
  exposes: ExposeAst[];
  line: number;
  column: number;
}

const img = (token: IToken | undefined): string => (typeof token?.image === "string" ? token.image : "");
const is = (token: IToken | undefined, word: string): boolean => img(token).toLowerCase() === word;

class SrvdParser extends EmbeddedActionsParser {
  public constructor() {
    super(tokens, { recoveryEnabled: false, maxLookahead: 2 });
    this.performSelfAnalysis();
  }

  public srvd = this.RULE("srvd", (): SrvdAst => {
    const annotations: Annotations = {};
    this.MANY(() => {
      const annotation = this.SUBRULE(this.annotation);
      this.ACTION(() => setAnnotation(annotations, annotation[0], annotation[1]));
    });
    const define = this.CONSUME(Name, { ERR_MSG: "'define service'" });
    const service = this.CONSUME1(Name);
    const name = this.CONSUME2(Name);
    // "provider contracts odata_v4_ui" and similar additions
    this.MANY1({ GATE: () => this.LA(1).tokenType !== LCurly, DEF: () => this.CONSUME3(Name) });
    this.CONSUME(LCurly);
    const exposes: ExposeAst[] = [];
    this.MANY2(() => {
      const expose = this.SUBRULE(this.expose);
      this.ACTION(() => exposes.push(expose));
    });
    this.CONSUME(RCurly);
    this.OPTION(() => this.CONSUME(Semicolon));
    const wellFormed = is(define, "define") && is(service, "service") && exposes.every((e) => e.wellFormed !== false);
    return { name: img(name), wellFormed, annotations, exposes, line: define.startLine ?? 0, column: define.startColumn ?? 0 };
  });

  private expose = this.RULE("expose", (): ExposeAst => {
    const annotations: Annotations = {};
    this.MANY(() => {
      const annotation = this.SUBRULE(this.annotation);
      this.ACTION(() => setAnnotation(annotations, annotation[0], annotation[1]));
    });
    const keyword = this.CONSUME(Name, { ERR_MSG: "'expose'" });
    const entity = this.CONSUME1(Name);
    let alias: string | undefined;
    this.OPTION({
      GATE: () => is(this.LA(1), "as"),
      DEF: () => {
        this.CONSUME2(Name);
        alias = img(this.CONSUME3(Name));
      },
    });
    this.CONSUME(Semicolon);
    const result: ExposeAst = { entity: img(entity), wellFormed: is(keyword, "expose"), annotations, line: keyword.startLine ?? 0, column: keyword.startColumn ?? 0 };
    if (alias !== undefined) {
      result.alias = alias;
    }
    return result;
  });

  private annotation = this.RULE("annotation", (): [string, AnnotationValue] => {
    this.CONSUME(At);
    const path = this.SUBRULE(this.dottedName);
    let value: AnnotationValue = true;
    this.OPTION(() => {
      this.CONSUME(Colon);
      value = this.SUBRULE(this.annotationValue);
    });
    return [path, value];
  });

  private dottedName = this.RULE("dottedName", (): string => {
    let text = img(this.CONSUME(Name));
    this.MANY(() => {
      this.CONSUME(Dot);
      text += `.${img(this.CONSUME1(Name))}`;
    });
    return text;
  });

  private annotationValue = this.RULE("annotationValue", (): AnnotationValue => {
    return this.OR([
      { ALT: () => img(this.CONSUME(StringLiteral)).slice(1, -1).replace(/''/g, "'") },
      { ALT: () => Number(img(this.CONSUME(NumberLiteral))) },
      {
        ALT: () => {
          this.CONSUME(Hash);
          return `#${img(this.CONSUME(Name))}`;
        },
      },
      {
        ALT: (): AnnotationValue => {
          const word = img(this.CONSUME1(Name));
          return word.toLowerCase() === "true" ? true : word.toLowerCase() === "false" ? false : word;
        },
      },
      {
        ALT: (): AnnotationValue => {
          const values: AnnotationValue[] = [];
          this.CONSUME(LBracket);
          this.MANY_SEP({
            SEP: Comma,
            DEF: () => {
              const v = this.SUBRULE(this.annotationValue);
              this.ACTION(() => values.push(v));
            },
          });
          this.CONSUME(RBracket);
          return values;
        },
      },
      {
        ALT: (): AnnotationValue => {
          const object: AnnotationObject = {};
          this.CONSUME(LCurly);
          this.MANY_SEP1({
            SEP: Comma,
            DEF: () => {
              const key = this.SUBRULE1(this.dottedName);
              this.CONSUME(Colon);
              const v = this.SUBRULE1(this.annotationValue);
              this.ACTION(() => setAnnotation(object, key, v));
            },
          });
          this.CONSUME(RCurly);
          return object;
        },
      },
    ]);
  });
}

let parser: SrvdParser | undefined;

export interface SrvdParseResult {
  ast?: SrvdAst;
  errors: Array<{ message: string; line: number; column: number }>;
}

export function parseSrvd(source: string): SrvdParseResult {
  const lexed = srvdLexer.tokenize(source);
  const errors = lexed.errors.map((e) => ({ message: `unexpected character "${source.substr(e.offset, e.length)}"`, line: e.line ?? 0, column: e.column ?? 0 }));
  if (errors.length > 0) {
    return { errors };
  }
  parser ??= new SrvdParser();
  parser.input = lexed.tokens;
  const ast = parser.srvd();
  for (const e of parser.errors) {
    errors.push({
      message: `syntax error at "${e.token.image}": ${e.message.replace(/\s+/g, " ")}`,
      line: Number.isFinite(e.token.startLine) ? (e.token.startLine as number) : 0,
      column: Number.isFinite(e.token.startColumn) ? (e.token.startColumn as number) : 0,
    });
  }
  if (errors.length > 0) {
    return { errors };
  }
  if (!ast.wellFormed) {
    errors.push({ message: "expected 'define service <name> { expose <entity> [as <alias>]; … }'", line: ast.line, column: ast.column });
  }
  return errors.length > 0 ? { errors } : { ast, errors };
}
