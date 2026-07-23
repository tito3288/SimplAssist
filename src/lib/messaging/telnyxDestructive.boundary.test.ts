import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const ADAPTER = path.join(
  SOURCE_ROOT,
  "lib/messaging/telnyxDestructive.ts"
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    if (
      !/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ||
      /\.test\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)
    ) {
      return [];
    }
    return [absolute];
  });
}

describe("destructive Telnyx source boundary", () => {
  it("keeps all known destructive SDK calls inside the guarded adapter", () => {
    const destructiveMemberPaths = [
      "phoneNumbers.delete",
      "phoneNumberCampaigns.delete",
      "campaign.deactivate",
      "brand.delete",
      "messagingProfiles.delete",
      "callControlApplications.delete",
    ];
    const destructivePaths = destructiveMemberPaths.map((value) =>
      value.split(".")
    );
    const violations: string[] = [];

    function memberPath(node: ts.Node): string[] | null {
      if (ts.isIdentifier(node)) return [node.text];
      if (ts.isPropertyAccessExpression(node)) {
        const parent = memberPath(node.expression);
        return parent ? [...parent, node.name.text] : null;
      }
      if (ts.isElementAccessExpression(node)) {
        const parent = memberPath(node.expression);
        const argument = node.argumentExpression;
        if (
          !parent ||
          (!ts.isStringLiteral(argument) &&
            !ts.isNoSubstitutionTemplateLiteral(argument))
        ) {
          return null;
        }
        return [...parent, argument.text];
      }
      return null;
    }

    function endsWithPath(pathParts: string[], suffix: string[]): boolean {
      return (
        pathParts.length >= suffix.length &&
        suffix.every(
          (part, index) =>
            pathParts[pathParts.length - suffix.length + index] === part
        )
      );
    }

    for (const file of sourceFiles(SOURCE_ROOT)) {
      if (file === ADAPTER) continue;
      const source = readFileSync(file, "utf8");
      const normalized = source
        .replace(/\s+/g, "")
        .replace(/\[['"]([^'"]+)['"]\]/g, ".$1")
        .replace(/\?\./g, ".");
      for (const memberPath of destructiveMemberPaths) {
        if (normalized.includes(memberPath)) {
          violations.push(`${path.relative(SOURCE_ROOT, file)}: ${memberPath}`);
        }
      }

      const parsed = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)
        ) {
          const pathParts = memberPath(node);
          if (pathParts) {
            for (const destructivePath of destructivePaths) {
              if (endsWithPath(pathParts, destructivePath)) {
                violations.push(
                  `${path.relative(SOURCE_ROOT, file)}: ${destructivePath.join(".")}`
                );
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);

      if (
        /api\.telnyx\.com/i.test(source) &&
        /method\s*:\s*["']DELETE["']/i.test(source)
      ) {
        violations.push(
          `${path.relative(SOURCE_ROOT, file)}: direct Telnyx DELETE fetch`
        );
      }
    }

    expect(Array.from(new Set(violations))).toEqual([]);
  });
});
