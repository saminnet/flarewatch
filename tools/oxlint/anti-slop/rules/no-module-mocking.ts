import { defineRule } from "@oxlint/plugins";

import { staticMemberName, staticPropertyName } from "../shared/property-key.ts";
import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);

// Harnesses that re-export the Vitest API under their own specifier. Without these, a test that
// imports `vi` from the wrapper resolves to a non-matching source and the rule stays silent.
const viSources = new Set(["vitest", "vite-plus/test"]);
// Vitest exports `vitest` as an alias of `vi`.
const viNames = new Set(["vi", "vitest"]);
const jestSources = new Set(["@jest/globals"]);

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

function importSource(definition: { type: string; parent?: ESTree.Node | null }): string | null {
  if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
    return null;
  }
  const source = definition.parent.source.value;
  return typeof source === "string" ? source : null;
}

/** True for `ns` in `import * as ns from "vitest"`, which reaches `ns.vi.mock`. */
function isTestFrameworkNamespace(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier") return false;
  const variable = resolveVariable(sourceCode, expression);
  return (
    variable !== null &&
    variable.defs.some((definition) => {
      const source = importSource(definition);
      return (
        source !== null &&
        definition.node.type === "ImportNamespaceSpecifier" &&
        (viSources.has(source) || jestSources.has(source))
      );
    })
  );
}

function isTestFrameworkObject(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
): expression is ESTree.IdentifierReference {
  if (expression.type !== "Identifier") return false;
  if (
    (expression.name === "vi" || expression.name === "jest") &&
    sourceCode.isGlobalReference(expression)
  ) {
    return true;
  }

  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) {
    return expression.name === "vi" || expression.name === "jest";
  }
  return variable.defs.some((definition) => {
    const source = importSource(definition);
    if (source === null) return false;
    const name = importedName(definition.node);
    return (
      (name !== null && viNames.has(name) && viSources.has(source)) ||
      (name === "jest" && jestSources.has(source))
    );
  });
}

/** True for the `vi` in `import * as ns from "vitest"; ns.vi.mock(...)`, computed access included. */
function isNamespacedTestFrameworkObject(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
): boolean {
  if (expression.type !== "MemberExpression" || expression.object.type === "Super") return false;
  const name = staticMemberName(expression);
  if (name === null || (!viNames.has(name) && name !== "jest")) return false;
  return isTestFrameworkNamespace(sourceCode, expression.object);
}

function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (!("property" in callee) || !("object" in callee) || !("computed" in callee)) return false;
  const target = callee.object;
  if (target.type === "Super") return false;
  if (
    !isTestFrameworkObject(sourceCode, target) &&
    !isNamespacedTestFrameworkObject(sourceCode, target)
  ) {
    return false;
  }
  const property = callee.property;
  // Local patch: upstream reads a computed key only as a string literal, so a template key escapes.
  const method = callee.computed
    ? staticPropertyName(property)
    : property.type === "Identifier"
      ? property.name
      : null;
  return method !== null && moduleMockMethods.has(method);
}

/** Ban test framework module mocking in favor of real dependency seams. */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces.",
    },
    messages: {
      moduleMock:
        "Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (moduleMockCall(context.sourceCode, node.callee)) {
          context.report({ node, messageId: "moduleMock" });
        }
      },
    };
  },
});
