// Hardcoded quick-pick list for the Predictor's manual team inputs — top
// clubs from the biggest leagues plus the national teams likely to matter
// during WC 2026, so typing "ar" surfaces Arsenal/Argentina instantly
// instead of the user having to spell a full name exactly.
export const TOP_CLUBS: string[] = [
  // Premier League
  'Arsenal', 'Manchester City', 'Manchester United', 'Liverpool', 'Chelsea',
  'Tottenham', 'Newcastle United', 'Aston Villa', 'Brighton', 'West Ham',
  // La Liga
  'Real Madrid', 'Barcelona', 'Atletico Madrid', 'Sevilla', 'Real Sociedad', 'Villarreal',
  // Serie A
  'Juventus', 'Inter Milan', 'AC Milan', 'Napoli', 'Roma', 'Atalanta',
  // Bundesliga
  'Bayern Munich', 'Borussia Dortmund', 'RB Leipzig', 'Bayer Leverkusen',
  // Ligue 1
  'Paris Saint-Germain', 'Monaco', 'Marseille', 'Lyon',
  // Other major clubs
  'Ajax', 'Porto', 'Benfica', 'Sporting CP', 'Celtic',
  // National teams (WC 2026)
  'Argentina', 'Brazil', 'France', 'England', 'Spain', 'Germany', 'Portugal',
  'Netherlands', 'Italy', 'Belgium', 'Croatia', 'Uruguay', 'Colombia',
  'Mexico', 'USA', 'Canada', 'Japan', 'Morocco', 'Switzerland', 'Egypt',
];

export function matchClubs(query: string, limit = 5): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return TOP_CLUBS.filter(c => c.toLowerCase().includes(q)).slice(0, limit);
}
