import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWithTimeout, badgeUrl } from './fixtures';

// Team crest resolution. Fixture payloads only sometimes carry badge URLs
// (TheSportsDB events frequently ship null badges — the "empty circles"
// bug), so anything that renders a crest resolves it by team name here:
// memory cache → AsyncStorage (permanent — crests don't change) →
// one searchteams.php lookup. Misses are remembered in-memory only, so a
// team TheSportsDB lacks doesn't hammer the API but gets retried next
// app launch.
const BASE = 'https://www.thesportsdb.com/api/v1/json/3';

// Same alias table logic as teamStats.searchTeamId — names TheSportsDB
// indexes differently than fixtures write them (each verified live).
const NAME_MAP: Record<string, string> = {
  'czechia': 'Czech Republic',
  'türkiye': 'Turkey',
  'turkiye': 'Turkey',
  'uae': 'United Arab Emirates',
};

const mem = new Map<string, string | null>();

export async function getTeamBadge(teamName: string): Promise<string | null> {
  const key = teamName.trim().toLowerCase();
  if (!key) return null;
  if (mem.has(key)) return mem.get(key)!;

  try {
    const stored = await AsyncStorage.getItem(`badge:${key}`);
    if (stored) { mem.set(key, stored); return stored; }
  } catch {}

  try {
    const mapped = NAME_MAP[key] ?? teamName;
    const res = await fetchWithTimeout(`${BASE}/searchteams.php?t=${encodeURIComponent(mapped)}`, 6000);
    const data = await res.json();
    const teams: any[] = data.teams ?? [];
    const soccer = teams.filter(t => /soccer|football/i.test(t.strSport ?? ''));
    const exact = soccer.find(t => (t.strTeam ?? '').toLowerCase() === mapped.toLowerCase());
    const raw = (exact ?? soccer[0])?.strBadge ?? null;
    const url = raw ? badgeUrl(raw) : null;
    mem.set(key, url);
    if (url) AsyncStorage.setItem(`badge:${key}`, url).catch(() => {});
    return url;
  } catch {
    mem.set(key, null);
    return null;
  }
}
