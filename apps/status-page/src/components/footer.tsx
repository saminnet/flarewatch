import { IconFlame } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { PageConfig } from '@flarewatch/shared';
import { ThemeToggle } from '@/components/theme-toggle';
import type { ThemePreference } from '@/lib/theme-server';
import { DEFAULT_POWERED_BY_URL, PAGE_CONTAINER_CLASSES } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface FooterProps {
  config?: PageConfig;
  theme?: ThemePreference;
}

export function Footer({ config, theme = 'system' }: FooterProps) {
  const { t } = useTranslation();
  const poweredByUrl = config?.poweredByUrl ?? DEFAULT_POWERED_BY_URL;

  return (
    <footer className="mt-auto border-t border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      <div className={cn(PAGE_CONTAINER_CLASSES, 'py-6')}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
            <IconFlame className="h-4 w-4 text-orange-500" />
            <span>
              {t('footer.poweredBy')}{' '}
              <a
                href={poweredByUrl}
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
          </div>
        </div>
      </div>
    </footer>
  );
}
