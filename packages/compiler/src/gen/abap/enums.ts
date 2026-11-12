/**
 * The constants of the CDS enumerated types in the ABAP code (D55): `zrt_status-open` is the
 * enumerated constant OPEN of the CDS enumerated type ZRT_STATUS. The transpiler knows no CDS
 * enumerated type: the type is given as a data element of its base type (shadow), and each
 * constant is replaced by the literal of its value, which keeps the line and the meaning of the
 * comparisons and assignments (the values of the database are the base values).
 */

import type { EnumTypeModel } from "@open-rap/model";

/** The ABAP literal of an enumerated value. */
function literalOf(enumType: EnumTypeModel, value: string | number): string {
  if (enumType.base.kind === "char" || enumType.base.kind === "numc") {
    const text = String(value);
    return `'${(text === "" ? " " : text).replace(/'/g, "''")}'`;
  }
  return String(value);
}

/**
 * Replaces `type-constant` outside literals, string templates and comments. Returns the source
 * unchanged when it names no enumerated type.
 */
export function replaceEnumConstants(source: string, enumTypes: readonly EnumTypeModel[]): string {
  if (enumTypes.length === 0) {
    return source;
  }
  const constants = new Map<string, Map<string, string>>();
  for (const enumType of enumTypes) {
    constants.set(enumType.name.toLowerCase(), new Map(enumType.values.map((v) => [v.name.toLowerCase(), literalOf(enumType, v.value)])));
  }
  const names = [...constants.keys()].map((n) => n.replace(/[/]/g, "\\/")).join("|");
  const pattern = new RegExp(`(^|[^A-Za-z0-9_/>-])(${names})-([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_])`, "gi");
  return source
    .split("\n")
    .map((line) => {
      if (line.startsWith("*")) {
        return line;
      }
      // the code parts of the line: outside '…', `…`, |…| and after a " comment
      let result = "";
      let code = "";
      let quote: string | undefined;
      const flush = (): void => {
        result += code.replace(pattern, (whole, before: string, type: string, constant: string) => {
          const literal = constants.get(type.toLowerCase())?.get(constant.toLowerCase());
          return literal === undefined ? whole : `${before}${literal}`;
        });
        code = "";
      };
      for (let i = 0; i < line.length; i++) {
        const c = line[i] ?? "";
        if (quote !== undefined) {
          result += c;
          if (c === quote) {
            quote = undefined;
          }
        } else if (c === "'" || c === "`" || c === "|") {
          flush();
          quote = c;
          result += c;
        } else if (c === '"') {
          flush();
          result += line.slice(i);
          return result;
        } else {
          code += c;
        }
      }
      flush();
      return result;
    })
    .join("\n");
}
