import { useRef, useState, useLayoutEffect, useEffect } from 'react';
import { useHydrated } from './use-hydrated';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function useContainerWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  const isHydrated = useHydrated();

  useIsomorphicLayoutEffect(() => {
    if (!ref.current) return;

    // Measure immediately on mount for synchronous layout
    setWidth(Math.floor(ref.current.getBoundingClientRect().width));

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const newWidth = Math.floor(entry.contentRect.width);
        setWidth((prev) => (prev === newWidth ? prev : newWidth));
      }
    });

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return { ref, width, isReady: isHydrated && width > 0 };
}
