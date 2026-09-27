import { Link } from '@tanstack/react-router';
import { IconFlame, IconHistory } from '@tabler/icons-react';
import type { PageConfig } from '@flarewatch/shared';
import { buttonVariants } from '@/components/ui/button-variants';
import { UserMenu } from '@/components/user-menu';
import type { Session } from '@/lib/session';
import { cn } from '@/lib/utils';

interface HeaderProps {
  config?: PageConfig;
  session: Session;
  visitorView: boolean;
}

export function Header({ config, session, visitorView }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="container mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
        <Link to="/" className="group flex min-w-0 items-center gap-2">
          {config?.logo ? (
            <img src={config.logo} alt="" className="h-8 w-8" />
          ) : (
            <IconFlame className="h-7 w-7 shrink-0 text-primary" />
          )}
          <span className="truncate text-lg font-semibold text-foreground transition-colors group-hover:text-primary/80">
            {config?.title || 'FlareWatch'}
          </span>
        </Link>

        {session.privateOnly && session.viewer === 'visitor' ? null : (
          <nav className="flex shrink-0 items-center gap-1" aria-label="Main navigation">
            <Link
              to="/history"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'sm' }),
                'text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground',
              )}
            >
              <IconHistory />
              History
            </Link>

            {session.viewer !== 'visitor' && (
              <UserMenu session={session} visitorView={visitorView} />
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
