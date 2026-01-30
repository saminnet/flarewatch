import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isSafeThemeCss(css: string): boolean {
  if (!css || typeof css !== 'string') return false;
  const lower = css.toLowerCase();
  return !lower.includes('</style') && !lower.includes('<script') && !lower.includes('javascript:');
}
