import { defineRule } from "vite-plus/lint/plugins";

import { enclosingFunction } from "../shared/function-node.ts";
import { staticMemberName } from "../shared/property-key.ts";
import { isReactSource } from "../shared/react-source.ts";

import type { FunctionNode } from "../shared/function-node.ts";
import type { ESTree } from "vite-plus/lint/plugins";

function configuredMax(option: unknown): number {
  if (typeof option !== "object" || option === null || !("max" in option)) return 1;
  const max = (option as { [key: string]: unknown })["max"];
  return typeof max === "number" && Number.isInteger(max) && max >= 1 ? max : 1;
}

function isUseStateCallee(callee: ESTree.Expression): boolean {
  if (callee.type === "Identifier") return callee.name === "useState";
  return callee.type === "MemberExpression" && staticMemberName(callee) === "useState";
}

function isBooleanFlag(call: ESTree.CallExpression): boolean {
  if (!isUseStateCallee(call.callee)) return false;
  const [initial] = call.arguments;
  if (initial?.type === "Literal" && typeof initial.value === "boolean") return true;
  const [typeArgument] = call.typeArguments?.params ?? [];
  return typeArgument?.type === "TSBooleanKeyword";
}

/** Reject a component that spreads one lifecycle over several boolean `useState` flags. */
export const noBooleanStateFlagsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow more than one boolean useState flag per component, because flags that change together belong in one status union.",
    },
    messages: {
      tooManyFlags:
        "This component holds {{count}} boolean useState flags. Flags that change together belong in one status union driven by a reducer, so an impossible combination cannot be represented.",
    },
    schema: [
      {
        type: "object",
        properties: {
          max: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{}],
  },
  createOnce(context) {
    let importsReact = false;
    let max = 1;
    const flags = new Map<FunctionNode, number>();

    return {
      Program(node) {
        flags.clear();
        max = configuredMax(context.options?.[0]);
        importsReact = node.body.some(
          (statement) =>
            statement.type === "ImportDeclaration" &&
            typeof statement.source.value === "string" &&
            isReactSource(statement.source.value),
        );
      },
      CallExpression(node) {
        if (!importsReact || !isBooleanFlag(node)) return;
        const owner = enclosingFunction(node);
        if (owner === null) return;
        const count = (flags.get(owner) ?? 0) + 1;
        flags.set(owner, count);
        if (count > max) {
          context.report({ node, messageId: "tooManyFlags", data: { count: String(count) } });
        }
      },
    };
  },
});
