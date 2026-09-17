import { defineRule } from "@oxlint/plugins";

import { staticMemberName, staticPropertyName } from "../shared/property-key.ts";

import type { ESTree } from "@oxlint/plugins";

type Argument = ESTree.CallExpression["arguments"][number];

/** `"json"` or `{ type: "json" }`, the read type Cloudflare KV's `get` and `getWithMetadata` take. */
function isJsonReadType(argument: Argument | undefined): boolean {
  if (argument === undefined) return false;
  if (argument.type === "Literal") return argument.value === "json";
  if (argument.type !== "ObjectExpression") return false;
  return argument.properties.some(
    (property) =>
      property.type === "Property" &&
      (property.computed
        ? staticPropertyName(property.key) === "type"
        : property.key.type === "Identifier" && property.key.name === "type") &&
      property.value.type === "Literal" &&
      property.value.value === "json",
  );
}

/** Require parsed JSON to remain unknown until a runtime boundary parser validates it. */
export const noJsonTypeArgumentRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow type arguments on JSON reads (.json(), KV get(key, \"json\")) because they do not validate input.",
    },
    messages: {
      uncheckedJson:
        "Do not pass a type argument to a JSON read; it validates nothing. Read the value as unknown and parse it with a runtime schema.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        let typeArguments = node.typeArguments;
        let callee = node.callee;
        while (callee.type !== "MemberExpression") {
          if (callee.type === "TSInstantiationExpression") {
            typeArguments ??= callee.typeArguments;
            callee = callee.expression;
            continue;
          }
          if (
            callee.type === "ChainExpression" ||
            callee.type === "ParenthesizedExpression" ||
            callee.type === "TSAsExpression" ||
            callee.type === "TSSatisfiesExpression" ||
            callee.type === "TSTypeAssertion" ||
            callee.type === "TSNonNullExpression"
          ) {
            callee = callee.expression;
            continue;
          }
          return;
        }
        if (!typeArguments?.params.length) return;
        const name = staticMemberName(callee);
        // A decode takes no arguments. `Response.json(data)` and other serializers take one,
        // and they claim a shape for data the caller already owns.
        const unchecked =
          name === "json"
            ? node.arguments.length === 0
            : (name === "get" || name === "getWithMetadata") && isJsonReadType(node.arguments[1]);
        if (unchecked) context.report({ node: typeArguments, messageId: "uncheckedJson" });
      },
    };
  },
});
