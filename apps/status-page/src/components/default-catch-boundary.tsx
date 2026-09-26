import type { ErrorComponentProps } from '@tanstack/react-router';
import { ErrorComponent, Link, rootRouteId, useMatch, useRouter } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter();
  const isRoot = useMatch({
    select: (state) => state.id === rootRouteId,
    strict: false,
  });

  return (
    <div className="container mx-auto flex min-h-[60vh] max-w-5xl items-center justify-center px-4 py-8">
      <Card className="w-full max-w-3xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-semibold text-destructive">
            Something went wrong
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg bg-muted p-4 text-sm text-foreground">
            <ErrorComponent error={error} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="outline" onClick={() => void router.invalidate()}>
              Try again
            </Button>

            {isRoot ? (
              <Link to="/" className={cn(buttonVariants({ variant: 'default' }))}>
                Home
              </Link>
            ) : (
              <Button
                variant="secondary"
                onClick={(e) => {
                  e.preventDefault();
                  window.history.back();
                }}
              >
                Go back
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
