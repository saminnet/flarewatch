import { defineRule } from "@oxlint/plugins";

import { staticMemberName } from "../shared/property-key.ts";

import type { ESTree } from "@oxlint/plugins";

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function;

function isZodSource(source: string): boolean {
  return source === "zod" || source.startsWith("zod/") || source === "@zod/mini";
}

function isFunction(node: ESTree.Node): node is FunctionNode {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
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
        let current: ESTree.Node | null = node.parent;
        while (current !== null && !isFunction(current)) current = current.parent;
        if (current !== null && isCheckCallback(current)) report(node.argument);
      },
    };
  },
});
