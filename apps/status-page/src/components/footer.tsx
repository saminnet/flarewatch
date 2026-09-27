import { Link } from '@tanstack/react-router';
import { IconFlame } from '@tabler/icons-react';
import type { PageConfig } from '@flarewatch/shared';
import { ThemeToggle } from '@/components/theme-toggle';
import type { ThemePreference } from '@/lib/theme-server';
import { DEFAULT_POWERED_BY_URL, PAGE_CONTAINER_CLASSES } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface FooterProps {
  config?: PageConfig;
  theme?: ThemePreference;
  showSignIn: boolean;
}

export function Footer({ config, theme = 'system', showSignIn }: FooterProps) {
  const poweredByUrl = config?.poweredByUrl ?? DEFAULT_POWERED_BY_URL;
  const linkClass = 'text-muted-foreground hover:text-foreground';

  return (
    <footer className="mt-auto border-t border-border bg-muted/30">
      <div className={PAGE_CONTAINER_CLASSES}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <IconFlame className="h-4 w-4 text-primary" />
            <span>
              Powered by{' '}
              <a
                href={poweredByUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground hover:underline"
              >
                FlareWatch
              </a>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {config?.links?.map((link) => (
              <a
                key={`${link.label}:${link.link}`}
                href={link.link}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(linkClass, link.highlight && 'font-medium text-foreground')}
              >
                {link.label}
              </a>
            ))}
            {showSignIn && (
              <Link to="/login" className={linkClass}>
                Sign in
              </Link>
            )}
            <ThemeToggle initialTheme={theme} />
          </div>
        </div>
      </div>
    </footer>
  );
}
