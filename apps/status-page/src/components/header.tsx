import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { IconFlame, IconHistory, IconExternalLink, IconMenu2 } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { PageConfig } from '@flarewatch/shared';

interface HeaderProps {
  config?: PageConfig;
}

export function Header({ config }: HeaderProps) {
  const { t } = useTranslation();

  const hasExternalLinks = config?.links && config.links.length > 0;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="container mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity group">
          {config?.logo ? (
            <img src={config.logo} alt="Logo" className="h-8 w-8" />
          ) : (
            <IconFlame className="h-7 w-7 text-orange-500" />
          )}
          <span className="text-lg font-semibold text-foreground group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
            {config?.title || 'FlareWatch'}
          </span>
        </Link>

        <nav className="flex items-center gap-1" aria-label="Main navigation">
          <Link to="/">
            <Button
              variant="ghost"
              size="sm"
              className="flex items-center gap-1.5"
              aria-label={t('nav.dashboard')}
            >
              <IconFlame className="h-4 w-4" />
              <span className="hidden sm:inline">{t('nav.dashboard')}</span>
            </Button>
          </Link>

          <Link to="/events">
            <Button
              variant="ghost"
              size="sm"
              className="flex items-center gap-1.5"
              aria-label={t('nav.events')}
            >
              <IconHistory className="h-4 w-4" />
              <span className="hidden sm:inline">{t('nav.events')}</span>
            </Button>
          </Link>

          {hasExternalLinks && (
            <>
              <div className="hidden sm:flex items-center gap-1">
                {config?.links?.map((link) => (
                  <a
                    key={`${link.label}:${link.link}`}
                    href={link.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      variant={link.highlight ? 'default' : 'ghost'}
                      size="sm"
                      className="flex items-center gap-1.5"
                      aria-label={link.label + ' (opens in new tab)'}
                    >
                      <span>{link.label}</span>
                      <IconExternalLink className="h-4 w-4" />
                    </Button>
                  </a>
                ))}
              </div>

              <div className="flex sm:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="inline-flex items-center justify-center rounded-md p-2 text-foreground hover:bg-muted"
                    aria-label="More links"
                  >
                    <IconMenu2 className="h-5 w-5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={8}>
                    {config?.links?.map((link) => (
                      <DropdownMenuItem
                        key={`${link.label}:${link.link}`}
                        render={
                          <a
                            href={link.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={link.label}
                          />
                        }
                      >
                        <span>{link.label}</span>
                        <IconExternalLink className="h-4 w-4 ml-auto" />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
