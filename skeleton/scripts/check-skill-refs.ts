#!/usr/bin/env bun

// check-skill-refs: CI gate for skeleton SKILL.md path references
//
// Enforced rule:
// Every consumer-relative file path in skeleton/.claude/skills/*/SKILL.md must exist.
// Paths starting with 'kongmy-stack/' are template-repo references and are skipped.
//
// Paths are extracted from:
// - Backtick-quoted paths (including inline in command examples)
// - Markdown links: [text](docs/guides/file.md)
//
// Convention (documented in SKILL.md footer):
// - Consumer paths: docs/, apps/, packages/, scripts/, acceptance/, modules/ (checked)
// - Template-repo paths: prefix with kongmy-stack/ (skipped)
//
// Exit codes:
// - 0: all referenced paths exist
// - 1: one or more paths missing
//
// Usage: bun scripts/check-skill-refs.ts

import * as fs from "fs";
import * as path from "path";

interface CheckResult {
  pass: boolean;
  errors: string[];
}

const result: CheckResult = {
  pass: true,
  errors: [],
};

// Find and read all SKILL.md files
const skillDir = path.join(process.cwd(), ".claude", "skills");
const skillFiles: Array<{ skillName: string; content: string; filePath: string }> = [];

if (fs.existsSync(skillDir)) {
  const skills = fs.readdirSync(skillDir);
  skills.forEach((skillName) => {
    const skillPath = path.join(skillDir, skillName, "SKILL.md");
    if (fs.existsSync(skillPath)) {
      const content = fs.readFileSync(skillPath, "utf-8");
      skillFiles.push({ skillName, content, filePath: skillPath });
    }
  });
}

// Extract file paths from SKILL.md content
// Patterns: backtick-quoted paths (including inline in command examples) and markdown links
// Skips paths starting with kongmy-stack/ (template-repo references)
function extractPaths(
  content: string
): Array<{ path: string; line: number }> {
  const paths: Array<{ path: string; line: number }> = [];
  const lines = content.split("\n");

  lines.forEach((line, i) => {
    const lineNum = i + 1;

    // Pattern 1: Backtick-quoted paths (including inline in command examples)
    // Matches: `path/to/file.ext` or `path-with-dashes/file.ext`
    const backtickRegex = /`([a-zA-Z0-9.\-_/]+\.[a-zA-Z0-9]+)`/g;
    let backtickMatch;
    while ((backtickMatch = backtickRegex.exec(line)) !== null) {
      const filePath = backtickMatch[1];
      // Check if it's a file-like path (contains / and has extension, or is a known template dir)
      if (
        !filePath.startsWith("http") &&
        filePath.includes("/") &&
        /^[a-zA-Z]/.test(filePath)
      ) {
        // Skip template-repo paths (prefixed with kongmy-stack/)
        if (!filePath.startsWith("kongmy-stack/")) {
          paths.push({ path: filePath, line: lineNum });
        }
      }
    }

    // Pattern 2: Markdown links [text](path/to/file)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(line)) !== null) {
      const linkPath = linkMatch[2];
      if (linkPath && /^[a-zA-Z]/.test(linkPath) && !linkPath.startsWith("http")) {
        // Skip template-repo paths
        if (!linkPath.startsWith("kongmy-stack/")) {
          paths.push({ path: linkPath, line: lineNum });
        }
      }
    }
  });

  return paths;
}

// Validate paths exist
const skeletonRoot = process.cwd();
let foundErrors = false;

skillFiles.forEach(({ skillName, content, filePath }) => {
  const extractedPaths = extractPaths(content);
  const seenPaths = new Set<string>();

  extractedPaths.forEach(({ path: refPath, line }) => {
    // Skip duplicates in the same file
    if (seenPaths.has(refPath)) return;
    seenPaths.add(refPath);

    const fullPath = path.join(skeletonRoot, refPath);
    if (!fs.existsSync(fullPath)) {
      foundErrors = true;
      result.errors.push(
        `${skillName}/SKILL.md:${line} — path not found: ${refPath}`
      );
    }
  });
});

// Report and exit
console.log("═".repeat(60));
console.log("Skill Reference Check");
console.log("═".repeat(60));
console.log();

if (foundErrors) {
  console.error("✗ Broken references found:");
  console.error();
  result.errors.forEach((err) => {
    console.error(`  ${err}`);
  });
  console.error();
  process.exit(1);
} else {
  console.log("✓ All skill references are valid");
  console.log();
  process.exit(0);
}
