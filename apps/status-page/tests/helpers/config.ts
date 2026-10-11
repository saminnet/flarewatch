import { afterEach } from 'vite-plus/test';

/** Puts each of `keys` back on `target` after every test: its value, or no key where there was none. */
export function restoreAfterEach<T extends object>(target: T, keys: (keyof T)[]): void {
  const saved = keys.map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(target, key),
  }));
  afterEach(() => {
    for (const { key, descriptor } of saved) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
  });
}
