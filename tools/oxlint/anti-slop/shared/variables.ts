import type { ESTree, Scope, SourceCode, Variable } from '@oxlint/plugins';

/** Resolves an identifier reference to its scope variable, walking outward. */
export function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

/**
 * The sole declarator of a single-definition variable. Null when a variable
 * has zero or multiple definitions — "the" declarator is then ambiguous and
 * callers skip rather than guess.
 */
export function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
  if (variable.defs.length !== 1) return null;
  const [definition] = variable.defs;
  return definition?.type === 'Variable' && definition.node.type === 'VariableDeclarator'
    ? definition.node
    : null;
}
