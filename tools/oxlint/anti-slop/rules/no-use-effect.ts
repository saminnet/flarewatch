import { defineRule } from "vite-plus/lint/plugins";

import { staticMemberName, staticPropertyName } from "../shared/property-key.ts";
import { isReactSource } from "../shared/react-source.ts";
import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode } from "vite-plus/lint/plugins";

const effectHooks = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

function exportedName(node: ESTree.ModuleExportName): string {
  return node.type === "Identifier" ? node.name : node.value;
}

function isReactBinding(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier") return false;
  const variable = resolveVariable(sourceCode, expression);
  return (
    variable !== null &&
    variable.defs.some(
      (definition) =>
        definition.type === "ImportBinding" &&
        definition.parent?.type === "ImportDeclaration" &&
        isReactSource(definition.parent.source.value) &&
        (definition.node.type === "ImportDefaultSpecifier" ||
          definition.node.type === "ImportNamespaceSpecifier"),
    )
  );
}

export const noUseEffectRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow React effect hooks in product code.",
    },
    messages: {
      effectHook:
        "React effect hooks are banned outside the hooks folder. Derive a value during render. Reset state with a key. Act in the event handler. Fetch through the data layer. A ref callback may only store, measure, observe, or position its own node. Move an effect that syncs with a system outside React into a named hook in the hooks folder, one sync job per hook.",
    },
    schema: [],
  },
  createOnce(context) {
    return {
      ImportDeclaration(node) {
        if (!isReactSource(node.source.value) || node.importKind === "type") return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.importKind !== "type" &&
            effectHooks.has(exportedName(specifier.imported))
          ) {
            context.report({ node: specifier, messageId: "effectHook" });
          }
        }
      },
      ExportNamedDeclaration(node) {
        if (
          node.source === null ||
          !isReactSource(node.source.value) ||
          node.exportKind === "type"
        ) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.exportKind !== "type" && effectHooks.has(exportedName(specifier.local))) {
            context.report({ node: specifier, messageId: "effectHook" });
          }
        }
      },
      MemberExpression(node) {
        const name = staticMemberName(node);
        if (name === null || !effectHooks.has(name) || node.object.type === "Super") return;
        if (isReactBinding(context.sourceCode, node.object)) {
          context.report({ node, messageId: "effectHook" });
        }
      },
      VariableDeclarator(node) {
        if (
          node.id.type !== "ObjectPattern" ||
          node.init === null ||
          !isReactBinding(context.sourceCode, node.init)
        ) {
          return;
        }
        for (const property of node.id.properties) {
          if (property.type === "RestElement") continue;
          const name =
            !property.computed && property.key.type === "Identifier"
              ? property.key.name
              : staticPropertyName(property.key);
          if (name !== null && effectHooks.has(name)) {
            context.report({ node: property, messageId: "effectHook" });
          }
        }
      },
    };
  },
});
