import { defineRule } from '@oxlint/plugins';

/** Require response JSON to remain unknown until a runtime boundary parser validates it. */
export const noResponseJsonTypeArgumentRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow type arguments on .json() calls because they do not validate input.',
    },
    messages: {
      uncheckedJson:
        'Do not pass a type argument to .json(); parse the unknown response body with a runtime schema.',
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        let typeArguments = node.typeArguments;
        let callee = node.callee;
        while (callee.type !== 'MemberExpression') {
          if (callee.type === 'TSInstantiationExpression') {
            typeArguments ??= callee.typeArguments;
            callee = callee.expression;
            continue;
          }
          if (
            callee.type === 'ChainExpression' ||
            callee.type === 'ParenthesizedExpression' ||
            callee.type === 'TSAsExpression' ||
            callee.type === 'TSSatisfiesExpression' ||
            callee.type === 'TSTypeAssertion' ||
            callee.type === 'TSNonNullExpression'
          ) {
            callee = callee.expression;
            continue;
          }
          return;
        }
        if (!typeArguments?.params.length) return;
        const { computed, property } = callee;
        const json =
          (!computed && property.type === 'Identifier' && property.name === 'json') ||
          (computed && property.type === 'Literal' && property.value === 'json');
        if (json) context.report({ node: typeArguments, messageId: 'uncheckedJson' });
      },
    };
  },
});
