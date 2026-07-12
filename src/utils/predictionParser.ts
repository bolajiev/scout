const FIELD_PATTERNS: Record<string, RegExp> = {
  winner: /^winner\s*:\s*(.+)$/im,
  score: /^score\s*:\s*(.+)$/im,
  confidence: /^confidence\s*:\s*(.+)$/im,
  homeWin: /^home\s*win\s*:\s*(.+)$/im,
  draw: /^draw\s*:\s*(.+)$/im,
  awayWin: /^away\s*win\s*:\s*(.+)$/im,
};
const STRUCTURED_LINE_RE = /^(winner|score|confidence|home\s*win|draw|away\s*win)\s*:/i;
const SEPARATOR_RE = /^-{3,}\s*$/;
const STARS_RE = /\*+/g;

export interface ParsedPrediction {
  winner: string; score: string; confidence: string;
  homeWin: string; draw: string; awayWin: string;
  analysis: string;
}

export function parsePrediction(text: string): ParsedPrediction {
  const clean = (s: string) => s.replace(STARS_RE, '').trim();
  const field = (name: keyof typeof FIELD_PATTERNS) => {
    const m = text.match(FIELD_PATTERNS[name]);
    return m ? clean(m[1]) : '';
  };
  const lines = text.split('\n');
  const sepIdx = lines.findIndex(l => SEPARATOR_RE.test(l.trim()));
  const analysis = sepIdx >= 0
    ? lines.slice(sepIdx + 1).join('\n').trim()
    : lines.filter(l => l.trim() && !STRUCTURED_LINE_RE.test(l.trim())).join('\n').trim();
  return {
    winner: field('winner'), score: field('score'), confidence: field('confidence'),
    homeWin: field('homeWin'), draw: field('draw'), awayWin: field('awayWin'),
    analysis,
  };
}

// Confidence renders as three outcome chips. The prompt asks for a number,
// but small models drift back to words — map either form, never render raw.
export function confidenceParts(raw: string): { pct: number | null; word: string } {
  const m = raw.match(/(\d{1,3})/);
  let pct = m ? Math.min(95, Math.max(5, parseInt(m[1], 10))) : null;
  if (pct == null) {
    const w = raw.toLowerCase();
    pct = w.includes('high') ? 80 : w.includes('med') ? 62 : w.includes('low') ? 45 : null;
  }
  const word = pct == null ? raw : pct >= 72 ? 'High' : pct >= 55 ? 'Medium' : 'Low';
  return { pct, word };
}
