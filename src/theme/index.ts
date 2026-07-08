// Redesign v3 — dark, near-black surfaces with a single volt-green accent.
// Chalk text, mist secondary, hairline white strokes. One radial volt glow
// per hero card is the only "decoration"; everything else is flat surface.
export interface Theme {
  // Surfaces
  background: string; // near-black app background
  card: string;       // surface
  cardAlt: string;    // surface-2 (raised elements, inputs, user bubbles)
  cardHot: string;    // kept for selected/emphasis states

  // Brand
  accent: string;     // volt green — CTAs, active tab, links, AI identity
  accentFg: string;   // ink — text/icons ON volt

  // Typography
  text: string;       // chalk
  textSecondary: string; // mist
  textTertiary: string;  // mist-dim

  // Structure
  border: string;     // hairline white stroke
  error: string;      // loss
  success: string;
  live: string;       // live pill red
  highlight: string;  // legacy kitYellow slot — unused in v3, kept so old refs compile

  // Semantic chips
  visionChip: string;
}

export const darkTheme: Theme = {
  background:    '#050505',
  card:          '#131313',
  cardAlt:       '#1a1a1a',
  cardHot:       '#222222',
  accent:        '#C6F53A',
  accentFg:      '#0b0b0b',
  text:          '#f5f5f5',
  textSecondary: '#9a9a9a',
  textTertiary:  '#616161',
  border:        'rgba(255,255,255,0.08)',
  error:         '#ff6b57',
  success:       '#C6F53A',
  live:          '#ff3b3b',
  highlight:     '#F5B80C',
  visionChip:    '#3b82f6',
};

// Single theme by design — every screen calls getTheme(useTheme()).
export function getTheme(_mode?: 'dark'): Theme {
  return darkTheme;
}
