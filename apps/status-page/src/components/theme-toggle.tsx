import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSun, IconMoon, IconDeviceDesktop } from '@tabler/icons-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { ThemePreference } from '@/lib/theme-server';
import { setThemePreferenceServerFn } from '@/lib/theme-server';

function applyTheme(theme: ThemePreference) {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;

  if (theme === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
    return;
  }

  if (theme === 'light') {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
    return;
  }

  const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';
}

function setThemePreferenceClient(theme: ThemePreference) {
  if (typeof window === 'undefined') return;

  const setTheme = (
    window as unknown as {
      __flarewatchSetThemePreference?: (t: ThemePreference) => void;
    }
  ).__flarewatchSetThemePreference;

  if (typeof setTheme === 'function') {
    setTheme(theme);
    return;
  }

  applyTheme(theme);
}

const themeOrder: ThemePreference[] = ['light', 'system', 'dark'];

const ThemeIcon = ({ theme }: { theme: ThemePreference }) => {
  const className = 'h-5 w-5';
  if (theme === 'light') return <IconSun className={className} />;
  if (theme === 'dark') return <IconMoon className={className} />;
  return <IconDeviceDesktop className={className} />;
};

export function ThemeToggle({ initialTheme }: { initialTheme: ThemePreference }) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);

  const cycleTheme = () => {
    const currentIndex = themeOrder.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themeOrder.length;
    const next = themeOrder[nextIndex] ?? 'system';

    setTheme(next);
    setThemePreferenceClient(next);
    void setThemePreferenceServerFn({ data: next });
  };

  const themeLabel =
    theme === 'light' ? t('theme.light') : theme === 'dark' ? t('theme.dark') : t('theme.system');

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={cycleTheme}
            className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
            aria-label={themeLabel}
          >
            <ThemeIcon theme={theme} />
          </button>
        }
      />
      <TooltipContent>{themeLabel}</TooltipContent>
    </Tooltip>
  );
}
