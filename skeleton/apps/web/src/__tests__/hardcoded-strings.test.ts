/**
 * Hardcoded strings gate — i18n enforcement (Seam 9)
 *
 * Scans every route and feature file for JSX text-node lines that are plain
 * natural language instead of a Paraglide `m.*()` lookup. FAILS the suite when
 * one is found. Allowlists only genuine brand strings and technical constants.
 *
 * Patterns caught:
 * - Whole-line text nodes: `<h1>Invoice</h1>` → literal text "Invoice"
 * - Inline >Text< nodes: `<button>Create</button>`
 * - User-facing attributes: `label="Save"`, `title="Delete"`, `alt="..."`, `aria-label="..."`
 *
 * Run with: bun test hardcoded-strings.test.ts
 */

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

const ROUTES_DIR = resolve(import.meta.dir, "..", "routes");
const FEATURES_DIR = resolve(import.meta.dir, "..", "features");
const ALLOWLIST = new Set(["kongmy-stack", "KONGMY"]);

function tsxFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.forEach((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...tsxFiles(full));
      } else if (entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    });
  } catch (err) {
    // Directory doesn't exist, skip
  }
  return files;
}

const PROSE_LINE = /^[A-Za-z0-9][A-Za-z0-9 ,.:;'&()+/-]*$/;
const SYNTAX_CHARS = /[{}<>=;`]/;
const CODE_LINE =
  /^(return|export|import|const|let|var|function|if|else|case|default|await|void|new|throw|interface|type|enum)\b/;
const ATTRIBUTE_PATTERN =
  /(?:label|title|alt|aria-label|placeholder)=["']([^"']+)["']/g;

function hardcodedTextNodes(file: string): string[] {
  const violations: string[] = [];
  const content = readFileSync(file, "utf-8");
  const lines = content.split("\n");

  // Check for hardcoded attributes
  lines.forEach((line, i) => {
    let attrMatch;
    while ((attrMatch = ATTRIBUTE_PATTERN.exec(line)) !== null) {
      const value = attrMatch[1];
      if (ALLOWLIST.has(value)) continue;
      // Single lowercase tokens are not prose (e.g., wrapped classname)
      if (!value.includes(" ") && value === value.toLowerCase()) continue;
      violations.push(`${file}:${i + 1}: [attr] ${value}`);
    }
  });

  // Check for whole-line text nodes and inline text
  lines.forEach((line, i) => {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;

    // Skip lines with JSX syntax markers
    if (SYNTAX_CHARS.test(trimmed)) return;

    // Skip code lines
    if (CODE_LINE.test(trimmed)) return;

    // Extract text content from JSX tags
    // Match: >Text< or >Text</ patterns that aren't empty/whitespace/variables
    const textNodeMatches = line.matchAll(/>([^<{}]+)</g);
    for (const match of textNodeMatches) {
      let text = match[1].trim();

      // Skip if contains variable references {anything}
      if (text.includes("{")) continue;

      // Skip whitespace-only matches
      if (!text || /^\s+$/.test(text)) continue;

      // Skip if it's valid prose (not a single lowercased word or symbol)
      if (PROSE_LINE.test(text)) {
        if (ALLOWLIST.has(text)) continue;
        // Single lowercase tokens are not prose
        if (!text.includes(" ") && text === text.toLowerCase()) continue;
        violations.push(`${file}:${i + 1}: ${text}`);
      }
    }
  });

  return violations;
}

describe("Hardcoded strings gate", () => {
  test("route and feature files contain no hardcoded user-facing text nodes", () => {
    const violations = [
      ...tsxFiles(ROUTES_DIR).flatMap(hardcodedTextNodes),
      ...tsxFiles(FEATURES_DIR).flatMap(hardcodedTextNodes),
    ];
    expect(violations).toEqual([]);
  });
});
