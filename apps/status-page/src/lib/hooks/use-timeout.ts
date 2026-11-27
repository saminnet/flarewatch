import { useEffect, useRef } from 'react';

export function useTimeout() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancel() {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function schedule(fn: () => void, ms: number) {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      fn();
    }, ms);
  }

  useEffect(() => cancel, []);

  return { schedule, cancel };
}
