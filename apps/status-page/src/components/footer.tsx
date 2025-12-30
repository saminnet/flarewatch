import { IconBrandGithub, IconFlame } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { PageConfig } from '@flarewatch/shared';
import { ThemeToggle } from '@/components/theme-toggle';
import type { ThemePreference } from '@/lib/theme-server';

interface FooterProps {
  config?: PageConfig;
  theme?: ThemePreference;
}

export function Footer({ config, theme = 'system' }: FooterProps) {
  const { t } = useTranslation();
  const githubLink = config?.links?.find((l) => l.label.toLowerCase() === 'github')?.link;

  return (
    <footer className="mt-auto border-t border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        {config?.customFooter ? (
          <div
            className="text-sm text-neutral-600 dark:text-neutral-400"
            dangerouslySetInnerHTML={{ __html: config.customFooter }}
          />
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <IconFlame className="h-4 w-4 text-orange-500" />
              <span>
                {t('footer.poweredBy')}{' '}
                <a
                  href="https://github.com/saminnet/flarewatch"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                >
                  FlareWatch
                </a>
              </span>
            </div>

            <div className="flex items-center gap-4">
              <ThemeToggle initialTheme={theme} />
              <a
                href={githubLink ?? 'https://github.com/saminnet/flarewatch'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                aria-label="GitHub"
              >
                <IconBrandGithub className="h-5 w-5" />
              </a>
            </div>
          </div>
        )}
      </div>
    </footer>
  );
}
