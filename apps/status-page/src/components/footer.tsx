import { Link } from '@tanstack/react-router';
import { IconFlame } from '@tabler/icons-react';
import type { PageConfig } from '@flarewatch/shared';
import { ThemeToggle } from '@/components/theme-toggle';
import type { ThemePreference } from '@/lib/theme-server';
import { DEFAULT_POWERED_BY_URL, PAGE_CONTAINER_CLASSES } from '@/lib/constants';

interface FooterProps {
  config?: PageConfig;
  theme?: ThemePreference;
  showSignIn: boolean;
}

export function Footer({ config, theme = 'system', showSignIn }: FooterProps) {
  const poweredByUrl = config?.poweredByUrl ?? DEFAULT_POWERED_BY_URL;

  return (
    <footer className="mt-auto border-t border-border bg-muted/30">
      <div className={PAGE_CONTAINER_CLASSES}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
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

          <div className="flex items-center gap-4">
            {showSignIn && (
              <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
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
