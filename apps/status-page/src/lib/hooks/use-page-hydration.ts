import { useEffect } from 'react';

let markHydrated = () => {};
export const pageHydrated = new Promise<void>((resolve) => {
  markHydrated = resolve;
});

/** Every page and error page must call this, or the first navigation from it never runs. */
export function usePageHydrated(): void {
  useEffect(() => markHydrated(), []);
}
