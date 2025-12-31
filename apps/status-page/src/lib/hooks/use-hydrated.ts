import { useSyncExternalStore } from 'react';

function subscribe(onStoreChange: () => void) {
  queueMicrotask(onStoreChange);
  return () => {};
}

function getSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
