import { useTurnstileWidget } from '@/lib/hooks/use-turnstile-widget';

export function Turnstile({ siteKey, refresh }: { siteKey: string; refresh: boolean }) {
  const { container, failed } = useTurnstileWidget(siteKey, refresh);
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
