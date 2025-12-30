import { createServerFn } from '@tanstack/react-start';
import { getCookie, setCookie } from '@tanstack/react-start/server';

export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_COOKIE = 'flarewatch_theme';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export const getThemePreferenceServerFn = createServerFn({
  method: 'GET',
}).handler(async () => {
  const cookieValue = getCookie(THEME_COOKIE);
  return isThemePreference(cookieValue) ? cookieValue : 'system';
});

export const setThemePreferenceServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown): ThemePreference => {
    if (!isThemePreference(data)) {
      throw new Error('Invalid theme preference');
    }
    return data;
  })
  .handler(async ({ data }) => {
    setCookie(THEME_COOKIE, data, {
      maxAge: ONE_YEAR_SECONDS,
      path: '/',
      sameSite: 'lax',
    });
  });

export function getThemeInitScript(theme: ThemePreference): string {
  const initialTheme = JSON.stringify(theme);

  return `(function(){try{var r=document.documentElement;var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');var c=${initialTheme};function a(p){c=p;r.dataset.theme=p;if(p==='dark'){r.classList.add('dark');r.style.colorScheme='dark';return}if(p==='light'){r.classList.remove('dark');r.style.colorScheme='light';return}var d=!!(m&&m.matches);r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light'}function h(){if(c==='system')a('system')}if(m){if(m.addEventListener)m.addEventListener('change',h);else if(m.addListener)m.addListener(h)}window.__flarewatchSetThemePreference=function(p){try{if(p==='light'||p==='dark'||p==='system')a(p)}catch(e){}};window.__flarewatchGetThemePreference=function(){return c};a(c)}catch(e){}})()`;
}
