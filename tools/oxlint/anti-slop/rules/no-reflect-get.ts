import { reflectMethodRule } from '../shared/reflect-method.ts';

/** Ban Reflect.get, which bypasses ordinary property access and useful type evidence. */
export const noReflectGetRule = reflectMethodRule(
  'get',
  'reflectGet',
  'Disallow Reflect.get; use typed property access or parse dynamic input into a domain type.',
  'Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.',
);
