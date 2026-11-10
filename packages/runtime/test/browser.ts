/**
 * Playwright for the browser tests of the generated UI: the few calls they use, typed here (the
 * project does not depend on Playwright; the tests are skipped without it).
 */

import { createRequire } from "node:module";

export interface Locator {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  last(): Locator;
  nth(index: number): Locator;
  locator(selector: string, options?: { hasText?: string }): Locator;
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
  textContent(): Promise<string | null>;
  isEnabled(): Promise<boolean>;
}
export interface Page {
  goto(url: string): Promise<unknown>;
  locator(selector: string, options?: { hasText?: string }): Locator;
  getByText(text: string, options?: { exact?: boolean }): Locator;
  waitForFunction(fn: string, arg?: unknown, options?: { timeout?: number }): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  on(event: string, listener: (value: unknown) => void): void;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
}
export interface Browser {
  newPage(options?: { viewport?: { width: number; height: number } }): Promise<Page>;
  close(): Promise<void>;
}

/** Playwright from the project, or the copy pre-installed in the development container. */
export function chromium(): { launch(): Promise<Browser> } | undefined {
  const require = createRequire(import.meta.url);
  for (const id of [process.env["PLAYWRIGHT_MODULE"], "playwright", "/opt/node-tools/node_modules/playwright"]) {
    if (id === undefined) continue;
    try {
      return (require(id) as { chromium: { launch(): Promise<Browser> } }).chromium;
    } catch {
      // next
    }
  }
  return undefined;
}

/** Id in the DOM of a control of a view of the generated application. */
export const id = (view: string, control: string): string => `#container-rapt---${view}--${control}`;

/** The data rows of the tables (not the column headers). */
export const ROWS = "tr.sapMLIB.sapMListTblRow";
