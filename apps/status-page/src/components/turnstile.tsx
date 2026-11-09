import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: { sitekey: string; theme: 'light' | 'dark' }): string;
      remove(id: string): void;
      reset(id: string): void;
    };
  }
}

export function Turnstile({ siteKey, refresh }: { siteKey: string; refresh: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    let active = true;
    script.onload = () => {
      if (active && container.current)
        widgetId.current = window.turnstile?.render(container.current, {
          sitekey: siteKey,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        });
    };
    script.onerror = () => {
      if (active) setFailed(true);
    };
    document.head.appendChild(script);
    return () => {
      active = false;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined;
      script.remove();
    };
  }, [siteKey]);
  useEffect(() => {
    if (refresh && widgetId.current) window.turnstile?.reset(widgetId.current);
  }, [refresh]);
  // Turnstile's widget is 300×65 px. Reserving the box keeps the panel still while it loads.
  return (
    <div className="grid h-16.25">
      <div ref={container} className="col-start-1 row-start-1" />
      {failed && (
        <p className="col-start-1 row-start-1 self-center text-xs text-muted-foreground">
          The verification check did not load. Reload the page to try again.
        </p>
      )}
    </div>
  );
}
