import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

type Operand = (node: ESTree.Expression, negated: boolean) => ESTree.Expression | null;

interface Idiom {
  readonly option: string;
  readonly typeName: string;
  readonly companion: Operand;
  /** When this operand is also present, the inline form already matches the helper exactly. */
  readonly exactWhen?: Operand;
}

function comparison(
  node: ESTree.Expression,
  wanted: readonly string[],
): { left: ESTree.Expression; right: ESTree.Expression } | null {
  if (node.type !== "BinaryExpression") return null;
  if (!wanted.includes(node.operator)) return null;
  if (node.left.type === "PrivateIdentifier") return null;
  return { left: node.left, right: node.right };
}

const equals = (negated: boolean) => (negated ? ["!==", "!="] : ["===", "=="]);
const differs = (negated: boolean) => (negated ? ["===", "=="] : ["!==", "!="]);

/** `typeof X === '<typeName>'`, or its negation. */
function typeofOperand(typeName: string): Operand {
  return (node, negated) => {
    const sides = comparison(node, equals(negated));
    if (sides === null) return null;
    const [unary, literal] =
      sides.left.type === "UnaryExpression" ? [sides.left, sides.right] : [sides.right, sides.left];
    if (unary.type !== "UnaryExpression" || unary.operator !== "typeof") return null;
    if (literal.type !== "Literal" || literal.value !== typeName) return null;
    return unary.argument.type === "Super" ? null : unary.argument;
  };
}

/** `X !== null`, or its negation. */
const nullOperand: Operand = (node, negated) => {
  const sides = comparison(node, differs(negated));
  if (sides === null) return null;
  const [subject, literal] =
    sides.right.type === "Literal" ? [sides.left, sides.right] : [sides.right, sides.left];
  if (literal.type !== "Literal" || literal.value !== null) return null;
  return subject.type === "Super" ? null : subject;
};

/** `X.length > 0` or `!X`, or their negations. */
const emptinessOperand: Operand = (node, negated) => {
  if (negated && node.type === "UnaryExpression" && node.operator === "!") {
    return node.argument.type === "Super" ? null : node.argument;
  }
  const sides = comparison(node, negated ? ["===", "=="] : [">", "!==", "!="]);
  if (sides === null) return null;
  const { left, right } = sides;
  if (right.type !== "Literal" || right.value !== 0) return null;
  if (left.type !== "MemberExpression" || left.computed) return null;
  if (left.property.type !== "Identifier" || left.property.name !== "length") return null;
  return left.object.type === "Super" ? null : left.object;
};

/** `!Array.isArray(X)`, or its negation. */
const arrayExclusionOperand: Operand = (node, negated) => {
  const call = negated
    ? node
    : node.type === "UnaryExpression" && node.operator === "!"
      ? node.argument
      : null;
  if (call === null || call.type !== "CallExpression") return null;
  const callee = call.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.object.type !== "Identifier" || callee.object.name !== "Array") return null;
  if (callee.property.type !== "Identifier" || callee.property.name !== "isArray") return null;
  const [argument] = call.arguments;
  if (argument === undefined || argument.type === "SpreadElement") return null;
  return argument;
};

const IDIOMS: readonly Idiom[] = [
  {
    option: "objectGuard",
    typeName: "object",
    companion: nullOperand,
    exactWhen: arrayExclusionOperand,
  },
  { option: "nonEmptyString", typeName: "string", companion: emptinessOperand },
];

/**
 * The helper a project exports for an idiom. An idiom with no configured helper is never reported,
 * so the rule stays inert until a repo opts in.
 */
function configuredHelper(option: unknown, idiom: string): string | null {
  if (typeof option !== "object" || option === null || !(idiom in option)) return null;
  const helper = (option as { [key: string]: unknown })[idiom];
  return typeof helper === "string" && helper.trim().length > 0 ? helper.trim() : null;
}

/** A reference with no call or computed access, so naming it twice cannot change the result. */
function isSimpleReference(node: ESTree.Expression): boolean {
  if (node.type === "Identifier" || node.type === "ThisExpression") return true;
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type !== "Super" &&
    isSimpleReference(node.object)
  );
}

/** Every operand of a same-operator chain, so a guard split across `&&` is still one guard. */
function flattenOperands(node: ESTree.Expression, operator: string): ESTree.Expression[] {
  if (node.type !== "LogicalExpression" || node.operator !== operator) return [node];
  return [...flattenOperands(node.left, operator), ...flattenOperands(node.right, operator)];
}

/** True while inside the declaration of `helper`, so the helper's own body is not reported. */
function insideHelper(node: ESTree.Node, helper: string): boolean {
  let current: ESTree.Node | null | undefined = node.parent;
  while (current) {
    if (current.type === "FunctionDeclaration" && current.id?.name === helper) return true;
    if (
      current.type === "VariableDeclarator" &&
      current.id.type === "Identifier" &&
      current.id.name === helper
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** Reject an inline idiom the project already exports a helper for. */
export const preferSharedHelperRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow re-implementing an idiom the project already exports a helper for.",
    },
    messages: {
      inlineIdiom:
        "Call `{{helper}}` instead of re-implementing it. A second copy of a predicate drifts from the first.",
      looserGuard:
        "Call `{{helper}}` instead of re-implementing this guard. This form also accepts arrays, so confirm the helper should too.",
    },
    schema: [
      {
        type: "object",
        properties: {
          objectGuard: { type: "string", minLength: 1 },
          nonEmptyString: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{}],
  },
  createOnce(context) {
    return {
      LogicalExpression(node) {
        const negated = node.operator === "||";
        if (!negated && node.operator !== "&&") return;
        // Report a chain once, from its outermost node.
        if (node.parent?.type === "LogicalExpression" && node.parent.operator === node.operator) {
          return;
        }

        const sourceCode: SourceCode = context.sourceCode;
        const key = (expression: ESTree.Expression): string =>
          sourceCode.getText(expression).replaceAll(/\s+/gu, "");
        const operands = flattenOperands(node, node.operator);

        for (const idiom of IDIOMS) {
          const helper = configuredHelper(context.options?.[0], idiom.option);
          if (helper === null) continue;

          const matchTypeof = typeofOperand(idiom.typeName);
          const subjects = new Set<string>();
          for (const operand of operands) {
            const subject = matchTypeof(operand, negated);
            if (subject !== null && isSimpleReference(subject)) subjects.add(key(subject));
          }
          if (subjects.size === 0) continue;

          for (const operand of operands) {
            const companion = idiom.companion(operand, negated);
            if (companion === null || !subjects.has(key(companion))) continue;
            if (insideHelper(node, helper)) return;
            const exact =
              idiom.exactWhen === undefined ||
              operands.some((other) => {
                const subject = idiom.exactWhen?.(other, negated) ?? null;
                return subject !== null && key(subject) === key(companion);
              });
            context.report({
              node,
              messageId: exact ? "inlineIdiom" : "looserGuard",
              data: { helper },
            });
            return;
          }
        }
      },
    };
  },
});
