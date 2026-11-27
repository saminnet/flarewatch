import type { ESTree } from "vite-plus/lint/plugins";

export type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function;

export function isFunction(node: ESTree.Node): node is FunctionNode {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

export function enclosingFunction(node: ESTree.Node): FunctionNode | null {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && !isFunction(current)) current = current.parent;
  return current;
}
