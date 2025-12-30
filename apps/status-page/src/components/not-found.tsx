import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function NotFound({ message }: { message?: string }) {
  const { t } = useTranslation();

  return (
    <div className="container mx-auto flex min-h-[60vh] max-w-5xl items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold">{t('error.pageNotFound')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {message ?? t('error.pageNotFoundDesc')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="outline" onClick={() => window.history.back()}>
              {t('action.goBack')}
            </Button>
            <Link to="/" className={cn(buttonVariants({ variant: 'default' }))}>
              {t('nav.home')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
