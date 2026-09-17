import { reflectMethodRule } from '../shared/reflect-method.ts';

/** Ban Reflect.apply, which bypasses ordinary typed function calls. */
export const noReflectApplyRule = reflectMethodRule(
  'apply',
  'reflectApply',
  'Disallow Reflect.apply; call typed functions directly or model dynamic dispatch behind an interface.',
  'Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.',
);
