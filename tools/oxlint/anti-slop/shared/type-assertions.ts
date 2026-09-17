import type { ESTree } from '@oxlint/plugins';

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

/** True for `as const` / `<const>` assertions, which narrow and never widen. */
export function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === 'TSTypeReference' &&
    node.typeAnnotation.typeName.type === 'Identifier' &&
    node.typeAnnotation.typeName.name === 'const'
  );
}
