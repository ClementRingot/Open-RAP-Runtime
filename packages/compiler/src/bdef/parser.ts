/**
 * Chevrotain grammar of behavior definitions (decision D1).
 *
 * The grammar covers managed and projection BDEFs without draft. Statements it does not know are
 * still recognized as "unknown" (up to the next `;` or a balanced `{ … }` block), so that the IR
 * builder can report them precisely instead of failing with an opaque syntax error.
 */

import { EmbeddedActionsParser, type IToken, type TokenType } from "chevrotain";
import type {
  BdefAst,
  BehaviorAst,
  BodyItemAst,
  Cardinality,
  EntityOptionAst,
  HeaderItemAst,
  ImplementationKind,
  Loc,
  Name as NameAst,
  OperationOptionAst,
  ResultAst,
  SideEffectAst,
  TriggerAst,
} from "./ast.js";
import {
  allTokens,
  Any,
  bdefLexer,
  Colon,
  Comma,
  Dot,
  DotDot,
  Equals,
  Integer,
  K,
  LBracket,
  LCurly,
  LParen,
  Name,
  RBracket,
  RCurly,
  RParen,
  Semicolon,
  Star,
  StringLiteral,
} from "./lexer.js";

function locOf(token: IToken | undefined): Loc {
  return { line: token?.startLine ?? 0, column: token?.startColumn ?? 0 };
}


/** Robust during the grammar recording phase, where OR() returns undefined. */
/** The image of a token; during the grammar recording phase tokens are placeholders. */
const img = (token: IToken | undefined): string => (typeof token?.image === "string" ? token.image : "");
const isWord = (token: IToken | undefined, word: string): boolean => img(token).toLowerCase() === word;
const lowerImage = (token: IToken | undefined): string => img(token).toLowerCase();

function nameOf(token: IToken): NameAst {
  return { text: img(token), loc: locOf(token) };
}

class BdefParser extends EmbeddedActionsParser {
  private source = "";

  public constructor() {
    super(allTokens, { recoveryEnabled: false, maxLookahead: 2 });
    this.performSelfAnalysis();
  }

  public setSource(source: string): void {
    this.source = source;
  }

  private textBetween(first: IToken | undefined, last: IToken | undefined): string {
    if (first === undefined || last === undefined || first.endOffset === undefined || last.endOffset === undefined) {
      return "";
    }
    return this.source.substring(first.startOffset, last.endOffset + 1).replace(/\s+/g, " ").trim();
  }

  // -------------------------------------------------------------------------------------------
  // top level

  public bdef = this.RULE("bdef", (): BdefAst => {
    const headers: HeaderItemAst[] = [];
    const behaviors: BehaviorAst[] = [];
    const others: Array<{ text: string; loc: Loc }> = [];
    this.MANY(() => {
      this.OR({
        IGNORE_AMBIGUITIES: true,
        DEF: [
          {
            GATE: () => isWord(this.LA(2), "behavior") || (isWord(this.LA(2), "root") && isWord(this.LA(3), "behavior")),
            ALT: () => {
              const behavior = this.SUBRULE(this.behavior);
              this.ACTION(() => behaviors.push(behavior));
            },
          },
          {
            ALT: () => {
              const header = this.SUBRULE(this.header);
              this.ACTION(() => {
                if (header.kind === "unknown" && /^(define|extend)\b/i.test(header.text)) {
                  others.push({ text: header.text, loc: header.loc });
                } else {
                  headers.push(header);
                }
              });
            },
          },
        ],
      });
    });
    return { headers, behaviors, others };
  });

  private header = this.RULE("header", (): HeaderItemAst => {
    const start = locOf(this.LA(1));
    return this.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        {
          ALT: (): HeaderItemAst => {
            const type = this.OR1([
              { ALT: () => this.CONSUME(K.managed) },
              { ALT: () => this.CONSUME(K.unmanaged) },
              { ALT: () => this.CONSUME(K.abstract) },
              { ALT: () => this.CONSUME(K.projection) },
              { ALT: () => this.CONSUME(K.interface) },
            ]);
            // managed with additional save / with unmanaged save [with full data] [and cleanup]
            let saving: { variant: "additional" | "unmanaged"; fullData: boolean } | undefined;
            this.OPTION7(() => {
              this.CONSUME2(K.with);
              const variant = this.OR7([
                { ALT: () => this.CONSUME(K.additional) },
                { ALT: () => this.CONSUME1(K.unmanaged) },
              ]);
              this.CONSUME(K.save);
              let fullData = false;
              this.MANY7({
                GATE: () => ["and", "cleanup", "full", "data"].includes(lowerImage(this.LA(1))) || (isWord(this.LA(1), "with") && isWord(this.LA(2), "full")),
                DEF: () => {
                  if (lowerImage(this.CONSUME7(Name)) === "full") {
                    fullData = true;
                  }
                },
              });
              saving = { variant: isWord(variant, "additional") ? "additional" : "unmanaged", fullData };
            });
            let className: NameAst | undefined;
            let unique = false;
            this.OPTION(() => {
              this.CONSUME(K.implementation);
              this.CONSUME(K.in);
              this.CONSUME(K.class);
              className = nameOf(this.CONSUME(Name));
              this.OPTION1(() => {
                this.CONSUME(K.unique);
                unique = true;
              });
            });
            this.CONSUME(Semicolon);
            const item: HeaderItemAst = { kind: "implementation", type: lowerImage(type) as ImplementationKind, unique, loc: start };
            if (className !== undefined) {
              item.className = className;
            }
            if (saving !== undefined) {
              item.saving = saving;
            }
            return item;
          },
        },
        {
          ALT: (): HeaderItemAst => {
            this.CONSUME(K.strict);
            let version = 1;
            this.OPTION2(() => {
              this.CONSUME(LParen);
              const v = this.CONSUME(Integer);
              this.CONSUME(RParen);
              version = Number.parseInt(img(v), 10);
            });
            this.CONSUME1(Semicolon);
            return { kind: "strict", version, loc: start };
          },
        },
        {
          ALT: (): HeaderItemAst => {
            this.CONSUME(K.with);
            this.CONSUME(K.draft);
            this.CONSUME2(Semicolon);
            return { kind: "withDraft", loc: start };
          },
        },
        {
          ALT: (): HeaderItemAst => {
            this.CONSUME1(K.with);
            this.CONSUME(K.privileged);
            this.CONSUME(K.mode);
            let disabling: NameAst | undefined;
            this.OPTION3(() => {
              this.CONSUME(K.disabling);
              disabling = nameOf(this.CONSUME1(Name));
            });
            this.CONSUME3(Semicolon);
            return disabling === undefined ? { kind: "privilegedMode", loc: start } : { kind: "privilegedMode", disabling, loc: start };
          },
        },
        {
          ALT: (): HeaderItemAst => {
            this.CONSUME(K.foreign);
            this.CONSUME(K.entity);
            const name = nameOf(this.CONSUME2(Name));
            this.CONSUME4(Semicolon);
            return { kind: "foreignEntity", name, loc: start };
          },
        },
        {
          ALT: (): HeaderItemAst => {
            this.CONSUME(K.use);
            const words: string[] = [];
            this.AT_LEAST_ONE(() => {
              words.push(lowerImage(this.CONSUME3(Name)));
            });
            this.CONSUME5(Semicolon);
            return { kind: "use", what: words.join(" "), loc: start };
          },
        },
        {
          ALT: (): HeaderItemAst => {
            const text = this.SUBRULE(this.unknownStatement);
            return { kind: "unknown", text, loc: start };
          },
        },
      ],
    });
  });

  /**
   * Tokens up to the next `;` (consumed) or up to the end of a balanced `{ … }` block (followed by
   * an optional `;`): a block ends a statement, as in `determine action x { … }`.
   */
  private unknownStatement = this.RULE("unknownStatement", (): string => {
    const first = this.LA(1);
    let last: IToken | undefined;
    this.OR([
      {
        ALT: () => {
          this.AT_LEAST_ONE(() => {
            last = this.CONSUME(Any);
          });
          this.OPTION(() => {
            last = this.SUBRULE(this.braceBlock);
          });
        },
      },
      { ALT: () => { last = this.SUBRULE1(this.braceBlock); } },
    ]);
    this.OPTION1(() => {
      last = this.CONSUME(Semicolon);
    });
    return this.ACTION(() => this.textBetween(first, last));
  });

  private braceBlock = this.RULE("braceBlock", (): IToken => {
    this.CONSUME(LCurly);
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(Any) },
        { ALT: () => this.CONSUME(Semicolon) },
        { ALT: () => this.SUBRULE(this.braceBlock) },
      ]);
    });
    return this.CONSUME(RCurly);
  });

  // -------------------------------------------------------------------------------------------
  // define behavior for

  private behavior = this.RULE("behavior", (): BehaviorAst => {
    const start = locOf(this.CONSUME(K.define));
    let root = false;
    this.OPTION(() => {
      this.CONSUME(K.root);
      root = true;
    });
    this.CONSUME(K.behavior);
    this.CONSUME(K.for);
    const entity = nameOf(this.CONSUME(Name));
    let alias: NameAst | undefined;
    this.OPTION1(() => {
      this.CONSUME(K.alias);
      alias = nameOf(this.CONSUME1(Name));
    });
    const options: EntityOptionAst[] = [];
    this.MANY(() => {
      const option = this.SUBRULE(this.entityOption);
      this.ACTION(() => {
        const previous = options[options.length - 1];
        if (option.kind === "unknown" && previous?.kind === "unknown") {
          previous.text = `${previous.text} ${option.text}`;
        } else {
          options.push(option);
        }
      });
    });
    this.CONSUME(LCurly);
    const items: BodyItemAst[] = [];
    this.MANY1(() => {
      const item = this.SUBRULE(this.bodyItem);
      this.ACTION(() => items.push(item));
    });
    this.CONSUME(RCurly);
    this.OPTION2(() => this.CONSUME(Semicolon));
    const behavior: BehaviorAst = { root, entity, options, items, loc: start };
    if (alias !== undefined) {
      behavior.alias = alias;
    }
    return behavior;
  });

  private entityOption = this.RULE("entityOption", (): EntityOptionAst => {
    const start = locOf(this.LA(1));
    return this.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME(K.persistent);
            this.CONSUME(K.table);
            return { kind: "persistentTable", table: nameOf(this.CONSUME(Name)), loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME(K.draft);
            this.CONSUME1(K.table);
            return { kind: "draftTable", table: nameOf(this.CONSUME1(Name)), loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME(K.lock);
            this.CONSUME(K.master);
            let unmanaged = false;
            this.OPTION(() => {
              this.CONSUME(K.unmanaged);
              unmanaged = true;
            });
            return { kind: "lockMaster", unmanaged, loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME1(K.lock);
            this.CONSUME(K.dependent);
            let by: NameAst | undefined;
            this.OPTION1(() => {
              this.CONSUME(K.by);
              by = nameOf(this.CONSUME2(Name));
            });
            this.OPTION2(() => this.SUBRULE(this.parenthesized));
            return by === undefined ? { kind: "lockDependent", loc: start } : { kind: "lockDependent", by, loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME(K.authorization);
            this.CONSUME1(K.master);
            const values = this.SUBRULE1(this.parenthesized);
            return { kind: "authorizationMaster", values, loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME1(K.authorization);
            this.CONSUME1(K.dependent);
            let by: NameAst | undefined;
            this.OPTION3(() => {
              this.CONSUME1(K.by);
              by = nameOf(this.CONSUME3(Name));
            });
            return by === undefined ? { kind: "authorizationDependent", loc: start } : { kind: "authorizationDependent", by, loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME(K.etag);
            this.CONSUME2(K.master);
            return { kind: "etagMaster", field: nameOf(this.CONSUME4(Name)), loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME1(K.etag);
            this.CONSUME2(K.dependent);
            let by: NameAst | undefined;
            this.OPTION4(() => {
              this.CONSUME2(K.by);
              by = nameOf(this.CONSUME5(Name));
            });
            return by === undefined ? { kind: "etagDependent", loc: start } : { kind: "etagDependent", by, loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME(K.total);
            this.CONSUME2(K.etag);
            return { kind: "totalEtag", field: nameOf(this.CONSUME6(Name)), loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME(K.early);
            this.CONSUME(K.numbering);
            return { kind: "earlyNumbering", loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME(K.late);
            this.CONSUME1(K.numbering);
            let inPlace = false;
            this.OPTION5(() => {
              this.CONSUME(K.in);
              this.CONSUME(K.place);
              inPlace = true;
            });
            return { kind: "lateNumbering", inPlace, loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME(K.implementation);
            this.CONSUME1(K.in);
            this.CONSUME(K.class);
            const className = nameOf(this.CONSUME7(Name));
            let unique = false;
            this.OPTION6(() => {
              this.CONSUME(K.unique);
              unique = true;
            });
            return { kind: "implementationInClass", className, unique, loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME(K.with);
            const variant = this.OR1([
              { ALT: () => this.CONSUME(K.additional) },
              { ALT: () => this.CONSUME1(K.unmanaged) },
            ]);
            this.CONSUME(K.save);
            // "and cleanup", "with full data"
            let fullData = false;
            this.MANY({
              GATE: () => ["and", "cleanup", "full", "data"].includes(lowerImage(this.LA(1))) || (isWord(this.LA(1), "with") && isWord(this.LA(2), "full")),
              DEF: () => {
                if (lowerImage(this.CONSUME8(Name)) === "full") {
                  fullData = true;
                }
              },
            });
            return { kind: "withSave", variant: isWord(variant, "additional") ? "additional" : "unmanaged", fullData, loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            this.CONSUME(K.use);
            this.CONSUME3(K.etag);
            return { kind: "useEtag", loc: start };
          },
        },
        {
          ALT: (): EntityOptionAst => {
            const token = this.CONSUME(Any);
            return { kind: "unknown", text: img(token), loc: start };
          },
        },
      ],
    });
  });

  /** `( a, b : c )`: the words, `name:value` for pairs. */
  private parenthesized = this.RULE("parenthesized", (): string[] => {
    const values: string[] = [];
    this.CONSUME(LParen);
    this.MANY_SEP({
      SEP: Comma,
      DEF: () => {
        const option = this.SUBRULE(this.optionItem);
        this.ACTION(() => values.push(option.value === undefined ? option.name : `${option.name}:${option.value}`));
      },
    });
    this.CONSUME(RParen);
    return values;
  });

  private optionItem = this.RULE("optionItem", (): OperationOptionAst => {
    const first = this.CONSUME(Name);
    let value: string | undefined;
    this.OPTION(() => {
      this.CONSUME(Colon);
      value = lowerImage(this.CONSUME1(Name));
    });
    const option: OperationOptionAst = { name: lowerImage(first), loc: locOf(first) };
    if (value !== undefined) {
      option.value = value;
    }
    return option;
  });

  private operationOptions = this.RULE("operationOptions", (): OperationOptionAst[] => {
    const options: OperationOptionAst[] = [];
    this.CONSUME(LParen);
    this.MANY_SEP({
      SEP: Comma,
      DEF: () => {
        const option = this.SUBRULE(this.optionItem);
        this.ACTION(() => options.push(option));
      },
    });
    this.CONSUME(RParen);
    return options;
  });

  // -------------------------------------------------------------------------------------------
  // entity body

  private bodyItem = this.RULE("bodyItem", (): BodyItemAst => {
    return this.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        { ALT: () => this.SUBRULE(this.operation) },
        { ALT: () => this.SUBRULE(this.useItem) },
        { ALT: () => this.SUBRULE(this.association) },
        { ALT: () => this.SUBRULE(this.fieldItem) },
        { ALT: () => this.SUBRULE(this.determination) },
        { ALT: () => this.SUBRULE(this.validation) },
        { ALT: () => this.SUBRULE(this.action) },
        { ALT: () => this.SUBRULE(this.mapping) },
        { ALT: () => this.SUBRULE(this.sideEffects) },
        {
          ALT: (): BodyItemAst => {
            const start = locOf(this.LA(1));
            const what = this.OR1([
              { ALT: () => img(this.CONSUME(K.draft)) },
              { ALT: () => img(this.CONSUME(K.event)) },
              { ALT: () => `${img(this.CONSUME(K.determine))} ${img(this.CONSUME(K.action))}` },
            ]);
            const text = this.SUBRULE(this.unknownStatement);
            const word = typeof what === "string" ? what : "";
            return { kind: "unsupported", what: word.toLowerCase(), text: `${word} ${typeof text === "string" ? text : ""}`, loc: start };
          },
        },
        {
          ALT: (): BodyItemAst => {
            const start = locOf(this.LA(1));
            const text = this.SUBRULE1(this.unknownStatement);
            return { kind: "unknown", text, loc: start };
          },
        },
      ],
    });
  });

  private operation = this.RULE("operation", (): BodyItemAst => {
    const start = locOf(this.LA(1));
    let internal = false;
    this.OPTION(() => {
      this.CONSUME(K.internal);
      internal = true;
    });
    const op = this.OR([
      { ALT: () => this.CONSUME(K.create) },
      { ALT: () => this.CONSUME(K.update) },
      { ALT: () => this.CONSUME(K.delete) },
    ]);
    let options: OperationOptionAst[] = [];
    this.OPTION1(() => {
      options = this.SUBRULE(this.operationOptions);
    });
    this.CONSUME(Semicolon);
    return { kind: "operation", op: lowerImage(op) as "create" | "update" | "delete", internal, options, loc: start };
  });

  private useItem = this.RULE("useItem", (): BodyItemAst => {
    const start = locOf(this.CONSUME(K.use));
    return this.OR([
      {
        ALT: (): BodyItemAst => {
          const op = this.OR1([
            { ALT: () => this.CONSUME(K.create) },
            { ALT: () => this.CONSUME(K.update) },
            { ALT: () => this.CONSUME(K.delete) },
          ]);
          let options: OperationOptionAst[] = [];
          this.OPTION(() => {
            options = this.SUBRULE(this.operationOptions);
          });
          this.CONSUME(Semicolon);
          return { kind: "useOperation", op: lowerImage(op) as "create" | "update" | "delete", options, loc: start };
        },
      },
      {
        ALT: (): BodyItemAst => {
          const kind = this.OR2([
            { ALT: () => this.CONSUME(K.action) },
            { ALT: () => this.CONSUME(K.function) },
          ]);
          const name = nameOf(this.CONSUME(Name));
          let alias: NameAst | undefined;
          this.OPTION1({
            GATE: () => isWord(this.LA(1), "as"),
            DEF: () => {
              this.CONSUME1(Name);
              alias = nameOf(this.CONSUME2(Name));
            },
          });
          this.OPTION2(() => {
            this.CONSUME(K.external);
            this.CONSUME(StringLiteral);
          });
          this.CONSUME1(Semicolon);
          const item: BodyItemAst = { kind: "useAction", actionKind: isWord(kind, "function") ? "function" : "action", name, loc: start };
          if (alias !== undefined) {
            item.alias = alias;
          }
          return item;
        },
      },
      {
        ALT: (): BodyItemAst => {
          this.CONSUME(K.association);
          const name = nameOf(this.CONSUME3(Name));
          let create = false;
          let withDraft = false;
          this.OR3([
            {
              ALT: () => {
                this.CONSUME(LCurly);
                this.MANY(() => {
                  this.OR4([
                    {
                      ALT: () => {
                        this.CONSUME1(K.create);
                        this.OPTION3(() => this.SUBRULE1(this.operationOptions));
                        this.CONSUME2(Semicolon);
                        create = true;
                      },
                    },
                    {
                      ALT: () => {
                        this.CONSUME(K.with);
                        this.CONSUME(K.draft);
                        this.CONSUME3(Semicolon);
                        withDraft = true;
                      },
                    },
                  ]);
                });
                this.CONSUME(RCurly);
              },
            },
            { ALT: () => this.CONSUME4(Semicolon) },
          ]);
          return { kind: "useAssociation", name, create, withDraft, loc: start };
        },
      },
    ]);
  });

  private association = this.RULE("association", (): BodyItemAst => {
    const start = locOf(this.LA(1));
    let internal = false;
    this.OPTION(() => {
      this.CONSUME(K.internal);
      internal = true;
    });
    this.CONSUME(K.association);
    const name = nameOf(this.CONSUME(Name));
    let abbreviation: NameAst | undefined;
    this.OPTION1(() => {
      this.CONSUME(K.abbreviation);
      abbreviation = nameOf(this.CONSUME1(Name));
    });
    let create: { internal: boolean; options: OperationOptionAst[] } | undefined;
    let withDraft = false;
    this.OR([
      {
        ALT: () => {
          this.CONSUME(LCurly);
          this.MANY(() => {
            this.OR1([
              {
                ALT: () => {
                  let createInternal = false;
                  this.OPTION2(() => {
                    this.CONSUME1(K.internal);
                    createInternal = true;
                  });
                  this.CONSUME(K.create);
                  let options: OperationOptionAst[] = [];
                  this.OPTION3(() => {
                    options = this.SUBRULE(this.operationOptions);
                  });
                  this.CONSUME(Semicolon);
                  create = { internal: createInternal, options };
                },
              },
              {
                ALT: () => {
                  this.CONSUME(K.with);
                  this.CONSUME(K.draft);
                  this.CONSUME1(Semicolon);
                  withDraft = true;
                },
              },
            ]);
          });
          this.CONSUME(RCurly);
        },
      },
      { ALT: () => this.CONSUME2(Semicolon) },
    ]);
    const item: BodyItemAst = { kind: "association", name, internal, withDraft, loc: start };
    if (abbreviation !== undefined) {
      item.abbreviation = abbreviation;
    }
    if (create !== undefined) {
      item.create = create;
    }
    return item;
  });

  private fieldItem = this.RULE("fieldItem", (): BodyItemAst => {
    const start = locOf(this.CONSUME(K.field));
    const characteristics: Array<{ text: string; loc: Loc }> = [];
    this.CONSUME(LParen);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const option = this.SUBRULE(this.optionItem);
        this.ACTION(() => characteristics.push({ text: option.value === undefined ? option.name : `${option.name}:${option.value}`, loc: option.loc }));
      },
    });
    this.CONSUME(RParen);
    const fields: NameAst[] = [];
    this.AT_LEAST_ONE_SEP1({
      SEP: Comma,
      DEF: () => {
        fields.push(nameOf(this.CONSUME(Name)));
      },
    });
    this.CONSUME(Semicolon);
    return { kind: "field", characteristics, fields, loc: start };
  });

  private triggers = this.RULE("triggers", (): TriggerAst => {
    const triggers: TriggerAst = { create: false, update: false, delete: false, fields: [] };
    this.CONSUME(LCurly);
    this.MANY(() => {
      this.OR([
        {
          ALT: () => {
            this.CONSUME(K.create);
            this.CONSUME(Semicolon);
            triggers.create = true;
          },
        },
        {
          ALT: () => {
            this.CONSUME(K.update);
            this.CONSUME1(Semicolon);
            triggers.update = true;
          },
        },
        {
          ALT: () => {
            this.CONSUME(K.delete);
            this.CONSUME2(Semicolon);
            triggers.delete = true;
          },
        },
        {
          ALT: () => {
            this.CONSUME(K.field);
            this.AT_LEAST_ONE_SEP({
              SEP: Comma,
              DEF: () => {
                const first = this.CONSUME(Name);
                let text = img(first);
                this.MANY1(() => {
                  this.CONSUME(Dot);
                  text += `.${img(this.CONSUME1(Name))}`;
                });
                triggers.fields.push({ text, loc: locOf(first) });
              },
            });
            this.CONSUME3(Semicolon);
          },
        },
      ]);
    });
    this.CONSUME(RCurly);
    return triggers;
  });

  private determination = this.RULE("determination", (): BodyItemAst => {
    const start = locOf(this.LA(1));
    let internal = false;
    this.OPTION(() => {
      this.CONSUME(K.internal);
      internal = true;
    });
    this.CONSUME(K.determination);
    const name = nameOf(this.CONSUME(Name));
    this.CONSUME(K.on);
    const on = this.OR([
      { ALT: () => this.CONSUME(K.modify) },
      { ALT: () => this.CONSUME(K.save) },
    ]);
    const triggers = this.SUBRULE(this.triggers);
    this.OPTION1(() => this.CONSUME(Semicolon));
    return { kind: "determination", name, on: isWord(on, "save") ? "save" : "modify", internal, triggers, loc: start };
  });

  private validation = this.RULE("validation", (): BodyItemAst => {
    const start = locOf(this.CONSUME(K.validation));
    const name = nameOf(this.CONSUME(Name));
    this.CONSUME(K.on);
    this.CONSUME(K.save);
    const triggers = this.SUBRULE(this.triggers);
    this.OPTION(() => this.CONSUME(Semicolon));
    return { kind: "validation", name, on: "save", triggers, loc: start };
  });

  private cardinality = this.RULE("cardinality", (): Cardinality => {
    this.CONSUME(LBracket);
    const bound = (): number | "*" =>
      this.OR([
        { ALT: () => Number.parseInt(this.CONSUME(Integer).image, 10) },
        { ALT: (): "*" => { this.CONSUME(Star); return "*"; } },
      ]);
    const min = bound();
    let max: number | "*" = min;
    this.OPTION(() => {
      this.CONSUME(DotDot);
      max = this.OR1([
        { ALT: () => Number.parseInt(this.CONSUME1(Integer).image, 10) },
        { ALT: (): "*" => { this.CONSUME1(Star); return "*"; } },
      ]);
    });
    this.CONSUME(RBracket);
    return { min: min === "*" ? 0 : min, max };
  });

  private action = this.RULE("action", (): BodyItemAst => {
    const start = locOf(this.LA(1));
    let internal = false;
    let isStatic = false;
    let factory = false;
    this.MANY(() => {
      this.OR([
        { ALT: () => { this.CONSUME(K.internal); internal = true; } },
        { ALT: () => { this.CONSUME(K.static); isStatic = true; } },
        { ALT: () => { this.CONSUME(K.factory); factory = true; } },
      ]);
    });
    const kind = this.OR1([
      { ALT: () => this.CONSUME(K.action) },
      { ALT: () => this.CONSUME(K.function) },
    ]);
    let options: OperationOptionAst[] = [];
    this.OPTION(() => {
      options = this.SUBRULE(this.operationOptions);
    });
    const name = nameOf(this.CONSUME(Name));
    let external: string | undefined;
    this.OPTION1(() => {
      this.CONSUME(K.external);
      external = img(this.CONSUME(StringLiteral)).slice(1, -1);
    });
    let parameter: NameAst | undefined;
    this.OPTION2(() => {
      this.CONSUME(K.parameter);
      parameter = nameOf(this.CONSUME1(Name));
    });
    let result: ResultAst | undefined;
    let factoryCardinality: Cardinality | undefined;
    this.OPTION3(() => {
      this.OR2([
        {
          ALT: () => {
            this.CONSUME(K.result);
            let selective = false;
            this.OPTION4(() => {
              this.CONSUME(K.selective);
              selective = true;
            });
            const cardinality = this.SUBRULE(this.cardinality);
            let entityKeyword = false;
            this.OPTION5(() => {
              this.CONSUME(K.entity);
              entityKeyword = true;
            });
            const entity = nameOf(this.CONSUME2(Name));
            result = { selective, cardinality, entity, entityKeyword };
          },
        },
        { ALT: () => { factoryCardinality = this.SUBRULE1(this.cardinality); } },
      ]);
    });
    // default value functions and similar blocks: `{ default function … ; }`
    this.OPTION6(() => this.SUBRULE(this.braceBlock));
    this.OPTION7(() => this.CONSUME(Semicolon));
    const item: BodyItemAst = {
      kind: "action",
      actionKind: isWord(kind, "function") ? "function" : "action",
      name,
      internal,
      static: isStatic,
      factory,
      options,
      loc: start,
    };
    if (external !== undefined) {
      item.external = external;
    }
    if (parameter !== undefined) {
      item.parameter = parameter;
    }
    if (result !== undefined) {
      item.result = result;
    }
    if (factoryCardinality !== undefined) {
      item.factoryCardinality = factoryCardinality;
    }
    return item;
  });

  private mapping = this.RULE("mapping", (): BodyItemAst => {
    const start = locOf(this.CONSUME(K.mapping));
    this.CONSUME(K.for);
    const table = nameOf(this.CONSUME(Name));
    let corresponding = false;
    this.OPTION(() => {
      this.CONSUME(K.corresponding);
      corresponding = true;
    });
    // "control <structure>" and other additions before the block
    this.MANY({
      GATE: () => this.LA(1).tokenType !== LCurly,
      DEF: () => this.CONSUME(Any),
    });
    const pairs: Array<{ field: NameAst; column: NameAst }> = [];
    this.OR([
      {
        ALT: () => {
          this.CONSUME(LCurly);
          this.MANY1(() => {
            const field = nameOf(this.CONSUME1(Name));
            this.CONSUME(Equals);
            const column = nameOf(this.CONSUME2(Name));
            this.MANY2(() => this.CONSUME1(Any));
            this.CONSUME(Semicolon);
            pairs.push({ field, column });
          });
          this.CONSUME(RCurly);
          this.OPTION1(() => this.CONSUME1(Semicolon));
        },
      },
      { ALT: () => this.CONSUME2(Semicolon) },
    ]);
    return { kind: "mapping", table, corresponding, pairs, loc: start };
  });

  private sideEffects = this.RULE("sideEffects", (): BodyItemAst => {
    const start = locOf(this.CONSUME(K.side));
    this.CONSUME(K.effects);
    this.CONSUME(LCurly);
    const items: SideEffectAst[] = [];
    this.MANY(() => {
      const tokens: IToken[] = [];
      this.AT_LEAST_ONE(() => tokens.push(this.CONSUME(Any)));
      this.CONSUME(Semicolon);
      this.ACTION(() => {
        const item = interpretSideEffect(tokens);
        if (item !== undefined) {
          items.push(item);
        }
      });
    });
    this.CONSUME(RCurly);
    this.OPTION(() => this.CONSUME1(Semicolon));
    return { kind: "sideEffects", items, loc: start };
  });
}

/** `field A affects field B, entity _X, messages;` and `action a affects …`. */
function interpretSideEffect(tokens: IToken[]): SideEffectAst | undefined {
  const words = tokens.map((t) => t.image);
  const lower = words.map((w) => w.toLowerCase());
  const affects = lower.indexOf("affects");
  if (affects < 2 || tokens[0] === undefined) {
    return undefined;
  }
  let trigger: SideEffectAst["trigger"];
  if (lower[0] === "determine" && lower[1] === "action" && tokens[2] !== undefined) {
    trigger = { kind: "determineAction", name: nameOf(tokens[2]) };
  } else if ((lower[0] === "field" || lower[0] === "action") && tokens[1] !== undefined) {
    trigger = { kind: lower[0], name: nameOf(tokens[1]) };
  } else {
    return undefined;
  }
  const targets: SideEffectAst["targets"] = [];
  const rest = words.slice(affects + 1).join(" ").split(/\s*,\s*/);
  for (const part of rest) {
    const [kind, ...path] = part.trim().split(/\s+/);
    const k = (kind ?? "").toLowerCase();
    if (k === "field" || k === "entity") {
      targets.push({ kind: k, path: path.join("").replace(/\s/g, "") });
    } else if (k === "messages") {
      targets.push({ kind: "messages", path: "" });
    } else if (k === "permissions") {
      targets.push({ kind: "permissions", path: path.join(" ") });
    } else if (k !== "") {
      targets.push({ kind: "unknown", path: part.trim() });
    }
  }
  return { trigger, targets, loc: locOf(tokens[0]) };
}

let parserInstance: BdefParser | undefined;

export interface BdefParseError {
  message: string;
  line: number;
  column: number;
}

export interface BdefParseResult {
  ast?: BdefAst;
  errors: BdefParseError[];
}

/** Parses a BDEF source. Returns the AST, or the lexing/parsing errors with their positions. */
export function parseBdef(source: string): BdefParseResult {
  const lexed = bdefLexer.tokenize(source);
  const errors: BdefParseError[] = lexed.errors.map((e) => ({
    message: `unexpected character "${source.substr(e.offset, e.length)}"`,
    line: e.line ?? 0,
    column: e.column ?? 0,
  }));
  if (errors.length > 0) {
    return { errors };
  }
  parserInstance ??= new BdefParser();
  const parser = parserInstance;
  parser.setSource(source);
  parser.input = lexed.tokens;
  const ast = parser.bdef();
  for (const e of parser.errors) {
    const token = e.token;
    const found = token.tokenType.name === "EOF" ? "end of file" : `"${token.image}"`;
    errors.push({
      message: `syntax error at ${found}: ${simplifyChevrotainMessage(e.message)}`,
      line: Number.isFinite(token.startLine) ? (token.startLine as number) : lastLine(source),
      column: Number.isFinite(token.startColumn) ? (token.startColumn as number) : 1,
    });
  }
  return errors.length > 0 ? { errors } : { ast, errors };
}

function lastLine(source: string): number {
  return source.split("\n").length;
}

function simplifyChevrotainMessage(message: string): string {
  return message.replace(/\s+/g, " ").replace(/<K_([a-z]+)>/g, "'$1'").replace(/<([A-Za-z]+)>/g, "$1").trim();
}

/** Exposed for tests: the token types, to check the grammar is LL(k) without ambiguity reports. */
export const bdefTokenTypes: readonly TokenType[] = allTokens;
