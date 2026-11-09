/** A minimal XML writer: elements, attributes, text, with escaping and indentation. */

export interface XmlElement {
  name: string;
  attributes?: Record<string, string | number | boolean | undefined>;
  children?: Array<XmlElement | string | undefined | false>;
}

export function el(name: string, attributes?: XmlElement["attributes"], ...children: Array<XmlElement | string | undefined | false>): XmlElement {
  const element: XmlElement = { name, children };
  if (attributes !== undefined) {
    element.attributes = attributes;
  }
  return element;
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderXml(root: XmlElement): string {
  const lines: string[] = ['<?xml version="1.0" encoding="utf-8"?>'];
  const render = (element: XmlElement, indent: string): void => {
    const attributes = Object.entries(element.attributes ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
      .join("");
    const children = (element.children ?? []).filter((c): c is XmlElement | string => c !== undefined && c !== false);
    if (children.length === 0) {
      lines.push(`${indent}<${element.name}${attributes}/>`);
      return;
    }
    if (children.every((c) => typeof c === "string")) {
      lines.push(`${indent}<${element.name}${attributes}>${children.map((c) => escapeXml(c as string)).join("")}</${element.name}>`);
      return;
    }
    lines.push(`${indent}<${element.name}${attributes}>`);
    for (const child of children) {
      if (typeof child === "string") {
        lines.push(`${indent}  ${escapeXml(child)}`);
      } else {
        render(child, `${indent}  `);
      }
    }
    lines.push(`${indent}</${element.name}>`);
  };
  render(root, "");
  return `${lines.join("\n")}\n`;
}
