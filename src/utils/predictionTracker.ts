// Prediction accountability: settle past predictions against real results
// from TheSportsDB and keep a running hit/miss record.

import { fetchTeamForm } from './teamStats';
import {
  getPendingPredictions, settlePrediction, getPredictionRecord,
} from './historyDb';

export { getPredictionRecord };

const norm = (s: string) => s.toLowerCase().trim();
const teamsMatch = (a: string, b: string) =>
  norm(a).includes(norm(b)) || norm(b).includes(norm(a));

// Try to settle up to `limit` pending predictions. Each check costs two
// TheSportsDB calls (team search + last results), so keep the batch small
// and only look at predictions old enough for the match to have finished.
export async function settlePendingPredictions(limit = 3): Promise<boolean> {
  let settledAny = false;
  let pending: ReturnType<typeof getPendingPredictions>;
  try {
    pending = getPendingPredictions(limit);
  } catch {
    return false;
  }

  const twoHours = 2 * 60 * 60 * 1000;
  for (const p of pending) {
    if (Date.now() - p.createdAt < twoHours) continue;
    try {
      const form = await fetchTeamForm(p.teamA);
      if (!form) continue;
      // Find the real result against the predicted opponent, played after
      // the prediction was made (small back-tolerance for kick-off time)
      const cutoff = new Date(p.createdAt - 6 * 60 * 60 * 1000).toISOString().split('T')[0];
      const event = form.events.find(e =>
        teamsMatch(e.opponent, p.teamB) && e.date >= cutoff,
      );
      if (!event) continue;

      // event.result is from teamA's perspective: W / D / L
      const predictedDraw = /draw/i.test(p.predictedWinner);
      const predictedA = !predictedDraw && teamsMatch(p.predictedWinner, p.teamA);
      const predictedB = !predictedDraw && teamsMatch(p.predictedWinner, p.teamB);
      const hit =
        (event.result === 'D' && predictedDraw) ||
        (event.result === 'W' && predictedA) ||
        (event.result === 'L' && predictedB);

      settlePrediction(p.id, event.score, hit ? 'hit' : 'miss');
      settledAny = true;
    } catch {
      // network or parsing issue — leave pending, try again next time
    }
  }
  return settledAny;
}
