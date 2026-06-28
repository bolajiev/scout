import { ThemeMode } from '../types';

export interface Theme {
  // Surfaces
  background: string;
  card: string;       // surface
  cardAlt: string;    // surfaceAlt (raised elements, inputs)

  // Brand
  accent: string;     // primary — brand yellow #FDC803
  accentFg: string;   // onPrimary — always black (text/icons ON yellow)

  // Typography
  text: string;
  textSecondary: string; // textMuted

  // Structure
  border: string;
  error: string;
  success: string;    // live/online status dot ONLY — never use as accent

  // Semantic chips
  visionChip: string; // vision model type indicator
}

export const darkTheme: Theme = {
  background:    '#080808',
  card:          '#111111',
  cardAlt:       '#171717',
  accent:        '#22c55e',
  accentFg:      '#000000',
  text:          '#f9fafb',
  textSecondary: '#6b7280',
  border:        '#1f1f1f',
  error:         '#ef4444',
  success:       '#22c55e',
  visionChip:    '#3b82f6',
};

export const lightTheme: Theme = {
  background:    '#f9fafb',
  card:          '#ffffff',
  cardAlt:       '#f3f4f6',
  accent:        '#16a34a',
  accentFg:      '#ffffff',
  text:          '#0a0a0a',
  textSecondary: '#6b7280',
  border:        '#e5e7eb',
  error:         '#ef4444',
  success:       '#16a34a',
  visionChip:    '#3b82f6',
};

export function getTheme(mode: ThemeMode): Theme {
  return mode === 'dark' ? darkTheme : lightTheme;
}
