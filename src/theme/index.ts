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
  background:    '#000000',
  card:          '#141414',
  cardAlt:       '#1E1E1E',
  accent:        '#FDC803',
  accentFg:      '#000000',
  text:          '#FFFFFF',
  textSecondary: '#9A9A9A',
  border:        '#2A2A2A',
  error:         '#FF5247',
  success:       '#2BD4A0',
  visionChip:    '#3B82F6',
};

// Light theme — dark is the only official theme for now; this is a stub
export const lightTheme: Theme = {
  background:    '#FAFAF5',
  card:          '#FFFFFF',
  cardAlt:       '#F0EFE8',
  accent:        '#D4A800',   // slightly deeper yellow for white bg
  accentFg:      '#000000',
  text:          '#0A0A0A',
  textSecondary: '#6B6B6B',
  border:        '#E0E0E0',
  error:         '#E53935',
  success:       '#2BD4A0',
  visionChip:    '#3B82F6',
};

export function getTheme(mode: ThemeMode): Theme {
  return mode === 'dark' ? darkTheme : lightTheme;
}
