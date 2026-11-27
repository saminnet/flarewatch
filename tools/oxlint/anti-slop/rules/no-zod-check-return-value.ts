import { defineRule } from "vite-plus/lint/plugins";

import { enclosingFunction } from "../shared/function-node.ts";
import { staticMemberName } from "../shared/property-key.ts";

import type { FunctionNode } from "../shared/function-node.ts";
import type { ESTree } from "vite-plus/lint/plugins";

function isZodSource(source: string): boolean {
  return source === "zod" || source.startsWith("zod/") || source === "@zod/mini";
}

/** True for a function written inline as an argument to `.check(...)`. */
function isCheckCallback(fn: FunctionNode): boolean {
  const call = fn.parent;
  if (call?.type !== "CallExpression" || call.callee === fn) return false;
  const callee = call.callee;
  if (callee.type !== "MemberExpression") return false;
  return staticMemberName(callee) === "check";
}

/** A value that carries nothing: `undefined` or `void expr`. */
function isVoidValue(node: ESTree.Expression): boolean {
  return (
    (node.type === "Identifier" && node.name === "undefined") ||
    (node.type === "UnaryExpression" && node.operator === "void")
  );
}

/** Reject a returned value from a zod `.check()` callback, which zod discards. */
export const noZodCheckReturnValueRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow returning a value from a zod .check() callback, because zod ignores it.",
    },
    messages: {
      ignoredReturn:
        "zod ignores what a .check() callback returns, so this value can never fail validation. Push an issue to ctx.issues, or pass a predicate through z.refine().",
    },
  },
  createOnce(context) {
    let importsZod = false;

    const report = (node: ESTree.Node) => context.report({ node, messageId: "ignoredReturn" });

    const checkArrowBody = (node: ESTree.ArrowFunctionExpression) => {
      if (!importsZod || !node.expression || !isCheckCallback(node)) return;
      const body = node.body;
      if (body.type !== "BlockStatement" && !isVoidValue(body)) report(body);
    };

    return {
      Program(node) {
        importsZod = node.body.some(
          (statement) =>
            statement.type === "ImportDeclaration" &&
            typeof statement.source.value === "string" &&
            isZodSource(statement.source.value),
        );
      },
      ArrowFunctionExpression: checkArrowBody,
      ReturnStatement(node) {
        if (!importsZod || node.argument === null || isVoidValue(node.argument)) return;
        const owner = enclosingFunction(node);
        if (owner !== null && isCheckCallback(owner)) report(node.argument);
      },
    };
  },
});
