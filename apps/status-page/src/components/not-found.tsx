import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function NotFound({ message }: { message?: string }) {
  return (
    <div className="container mx-auto flex min-h-[60vh] max-w-5xl items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold">Page not found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            {message ?? "The page you're looking for doesn't exist."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="outline" onClick={() => window.history.back()}>
              Go back
            </Button>
            <Link to="/" className={cn(buttonVariants({ variant: 'default' }))}>
              Home
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
