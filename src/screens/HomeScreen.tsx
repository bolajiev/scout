import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, Image, ScrollView, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { fonts } from '../theme/fonts';
import { useTheme } from '../navigation/AppNavigator';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { IconSettings, IconModels, IconClock } from '../components/Icons';
import { TAB_BAR_HEIGHT } from '../components/TabBar';
import { HalfwayDivider } from '../components/PitchLines';
import TeamBadge from '../components/TeamBadge';

const STADIUM = require('../../assets/stadium.jpg');
const BALL = require('../../assets/ball.png');

// Vertical scrim over the stadium backdrop: dark enough at the top for the
// header text, clear in the middle so the stadium reads, then a smooth
// fade into the solid #050505 page — "meet smoothly", no hard edge.
function StadiumFade() {
  return (
    <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <Defs>
        <LinearGradient id="stadiumfade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#050505" stopOpacity="0.6" />
          <Stop offset="0.32" stopColor="#050505" stopOpacity="0.12" />
          <Stop offset="0.66" stopColor="#050505" stopOpacity="0.62" />
          <Stop offset="1" stopColor="#050505" stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#stadiumfade)" />
    </Svg>
  );
}
import {
  fetchAndCacheFixtures, fetchFdMatchDetail, findClosestMatch, isLive, isFinished,
  fmtMatchTime, teamAbbr, isWorldCup, badgeUrl, fixtureOrder, todayISO, WC_NAME,
  type Fixture,
} from '../utils/fixtures';
import { getActiveFdKey, getActiveBzKey, getFdNudgeDismissed } from '../utils/storage';
import { TOP_LEAGUES } from '../utils/bzzoiro';
import FdKeyNudge from '../components/FdKeyNudge';
import ReportBugLink from '../components/ReportBugLink';
import { SkeletonHeroCard, SkeletonFixtureList } from '../components/Skeleton';
import { isOnline } from '../utils/network';

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// "Today" / "Tomorrow" / "Sat 11 Jul" group label from a YYYY-MM-DD date
function dateGroupLabel(dateEvent: string | null): string {
  const today = todayISO();
  if (!dateEvent || dateEvent === today) return 'Today';
  const t = new Date(today); t.setDate(t.getDate() + 1);
  if (dateEvent === t.toISOString().split('T')[0]) return 'Tomorrow';
  return new Date(dateEvent).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [matchOnline, setMatchOnline] = useState(true);
  const [matchFromCache, setMatchFromCache] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedComp, setSelectedComp] = useState<string | null>(null);
  const [showFdNudge, setShowFdNudge] = useState(false);
  const [bzActive, setBzActive] = useState(false);
  // Distinguishes "still fetching for the first time" from "fetched and
  // truly empty" — without this, the empty state (and its offline
  // messaging) would flash for a moment on every cold start before the
  // first fetch resolves, which reads as broken on a slow connection.
  const [initialLoading, setInitialLoading] = useState(true);
  // Set only when a fetch actually failed, by pinging a tiny external
  // endpoint to tell "no internet at all" apart from "device is online but
  // our data sources are slow/down" — two different messages, one bug
  // worth reporting and one that isn't.
  const [deviceOffline, setDeviceOffline] = useState<boolean | null>(null);
  const mountedRef = useRef(true);
  const lastFixtureFetchRef = useRef(0);
  const liveCountRef = useRef(0);
  // BUG FIX: refreshFixtures used to depend on `fixtures.length` directly,
  // so its identity changed on every single fetch that added/removed a
  // fixture. The focus effect below depends on refreshFixtures — and
  // React Navigation's useFocusEffect re-runs whenever its callback's
  // identity changes, not just on a real focus event (the same gotcha as
  // the modelId/qvacId bug). Net effect: any fixture-count change while
  // already on Matches could re-trigger the "just focused" logic, and
  // switching tabs and back always looked like a fresh reload even when
  // the data was seconds old. Reading the count from a ref instead keeps
  // refreshFixtures's identity permanently stable.
  const fixturesLenRef = useRef(0);

  const refreshFixtures = useCallback((force = false) => {
    const stale = Date.now() - lastFixtureFetchRef.current > 3 * 60_000;
    if (!force && !stale && fixturesLenRef.current > 0) return;
    lastFixtureFetchRef.current = Date.now();
    fetchAndCacheFixtures().then(({ fixtures: fx, fromCache, online }) => {
      if (!mountedRef.current) return;
      liveCountRef.current = fx.filter(isLive).length;
      fixturesLenRef.current = fx.length;
      setFixtures(fx);
      setMatchOnline(online);
      setMatchFromCache(fromCache);
      if (online) { setLastSyncedAt(Date.now()); setDeviceOffline(null); }
      else if (fx.length === 0) {
        isOnline().then(v => { if (mountedRef.current) setDeviceOffline(!v); });
      }
    }).catch(() => {}).finally(() => { if (mountedRef.current) setInitialLoading(false); });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refreshFixtures(true);
    // Home is a tab screen — it mounts once per app open and stays alive
    // while switching tabs, so a mount-only effect is exactly "once per
    // app open", not "once per visit". The nudge used to live in the
    // useFocusEffect below and re-check (and potentially reappear) every
    // single time the user came back to this tab from Coach/Predictor/etc.
    getFdNudgeDismissed().then(dismissed => {
      if (dismissed || !mountedRef.current) return;
      getActiveFdKey().then(k => { if (mountedRef.current) setShowFdNudge(!k); }).catch(() => {});
    }).catch(() => {});
    // Tab screen stays mounted while the app is open — tick every minute
    // during live matches so scores update; otherwise only when >3min stale.
    const interval = setInterval(() => refreshFixtures(liveCountRef.current > 0), 60_000);
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, [refreshFixtures]);

  const checkBzActive = useCallback(() => {
    getActiveBzKey().then(k => { if (mountedRef.current) setBzActive(!!k); }).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => {
    mountedRef.current = true;
    refreshFixtures();
    checkBzActive();
    return () => { mountedRef.current = false; };
  }, [refreshFixtures, checkBzActive]));

  // Live minute + goalscorer round-robin — football-data.org's bulk
  // /v4/matches list (used above for the fixture list) never includes
  // either field, only the per-match detail endpoint does. With the free
  // tier capped at 10 req/min, one match every 6.5s stays safely under
  // that even during a full slate of live matches, cycling through them so
  // each one's minute/scorer refreshes roughly every (live count * 6.5s).
  const fixturesRef = useRef<Fixture[]>([]);
  useEffect(() => { fixturesRef.current = fixtures; }, [fixtures]);

  useEffect(() => {
    let cancelled = false;
    let idx = 0;
    const tick = async () => {
      if (cancelled) return;
      const key = await getActiveFdKey().catch(() => '');
      if (!key) return;
      const liveFd = fixturesRef.current.filter(f => f.idEvent.startsWith('fd-') && isLive(f));
      if (liveFd.length === 0) return;
      const target = liveFd[idx % liveFd.length];
      idx++;
      const detail = await fetchFdMatchDetail(key, target.idEvent);
      if (cancelled || !mountedRef.current) return;
      setFixtures(prev => prev.map(x => x.idEvent === target.idEvent ? {
        ...x,
        intHomeScore: detail.homeScore != null ? String(detail.homeScore) : x.intHomeScore,
        intAwayScore: detail.awayScore != null ? String(detail.awayScore) : x.intAwayScore,
        minute: detail.minute ?? x.minute,
        lastScorer: detail.lastScorer ?? x.lastScorer,
      } : x));
    };
    const interval = setInterval(tick, 6500);
    tick();
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    lastFixtureFetchRef.current = 0;
    refreshFixtures(true);
    setTimeout(() => { if (mountedRef.current) setRefreshing(false); }, 900);
  }, [refreshFixtures]);

  // Hero = the closest match (live first, then next kickoff)
  const hero = useMemo(() => findClosestMatch(fixtures), [fixtures]);

  // Competition filter chips — World Cup always pinned first (its own
  // dedicated tab, not dependent on today's fixtures happening to include
  // it), then the big-5 European leagues (when Bzzoiro is active, so
  // they're always tappable even with nothing on today), then whatever
  // else actually has a fixture, in kickoff order. Without pinning, this
  // list is just "whatever showed up" — how a NSW regional league ends up
  // sitting next to the World Cup.
  const comps = useMemo(() => {
    const seen = new Set<string>([WC_NAME]);
    const list: string[] = [WC_NAME];
    if (bzActive) {
      for (const l of TOP_LEAGUES) { if (!seen.has(l.name)) { seen.add(l.name); list.push(l.name); } }
    }
    for (const f of [...fixtures].sort((a, b) => fixtureOrder(a) - fixtureOrder(b))) {
      if (f.strLeague && !seen.has(f.strLeague)) { seen.add(f.strLeague); list.push(f.strLeague); }
    }
    return list;
  }, [fixtures, bzActive]);

  // World Cup is the default tab — set once on mount, not re-fired on every
  // refetch, so it never fights the user's own later taps (including back
  // to "All").
  const defaultedCompRef = useRef(false);
  useEffect(() => {
    if (defaultedCompRef.current) return;
    defaultedCompRef.current = true;
    setSelectedComp(WC_NAME);
  }, []);

  // Fixture list grouped by date ("Today" / "Tomorrow" / "Sat 11 Jul"),
  // WC-first within each group, hero excluded (it has its own panel)
  const groups = useMemo(() => {
    const filtered = fixtures.filter(f =>
      (!selectedComp || f.strLeague === selectedComp) && f.idEvent !== hero?.idEvent);
    const byDate = new Map<string, Fixture[]>();
    for (const f of filtered) {
      const key = f.dateEvent ?? todayISO();
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(f);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({
        label: dateGroupLabel(date),
        list: list.sort((a, b) => fixtureOrder(a) - fixtureOrder(b)),
      }));
  }, [fixtures, selectedComp, hero?.idEvent]);

  // Tapping a fixture used to jump straight into Predictor ("quick
  // predict"), skipping past any real context — now lands on a match
  // detail page (head-to-head, lineups, recent form) first, with its own
  // "Predict This Match" button continuing into Predictor exactly as
  // before.
  const openMatchDetail = (f: Fixture) =>
    navigation.navigate('MatchDetail', { fixture: f });

  const updatedAgo = lastSyncedAt
    ? Math.max(0, Math.round((Date.now() - lastSyncedAt) / 60_000))
    : null;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar barStyle="light-content" />

      <FdKeyNudge
        visible={showFdNudge}
        onSaved={() => { setShowFdNudge(false); lastFixtureFetchRef.current = 0; refreshFixtures(true); }}
        onDismiss={() => setShowFdNudge(false)}
      />

      {/* Stadium backdrop — fades smoothly into the black page */}
      <View style={styles.stadiumWrap} pointerEvents="none">
        <Image source={STADIUM} style={styles.stadiumImg} resizeMode="cover" />
        <StadiumFade />
      </View>

      {/* Match ball anchoring the bottom corner, behind everything */}
      <View style={styles.ballWrap} pointerEvents="none">
        <Image source={BALL} style={styles.ballInner} />
      </View>

      <View style={[styles.body, { paddingTop: insets.top + 14 }]}>

        {/* Header */}
        <View style={styles.topBar}>
          <View>
            <Text style={[styles.screenTitle, { color: theme.text }]}>Matches</Text>
          </View>
          <View style={styles.topActions}>
            <TouchableOpacity style={[styles.iconChip, { backgroundColor: theme.card, borderColor: theme.border }]} onPress={() => navigation.navigate('History')} hitSlop={HIT}>
              <IconClock size={16} color={theme.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.iconChip, { backgroundColor: theme.card, borderColor: theme.border }]} onPress={() => navigation.navigate('Models')} hitSlop={HIT}>
              <IconModels size={17} color={theme.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.iconChip, { backgroundColor: theme.card, borderColor: theme.border }]} onPress={() => navigation.navigate('Settings')} hitSlop={HIT}>
              <IconSettings size={17} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 36 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={theme.accent} colors={[theme.accent]} />
          }
        >
          {/* Hero — translucent card floating over the stadium backdrop,
              big kickoff time center, LIVE pill when in play. Was a plain
              "Loading matches..." text with nothing shaped like the card
              that was about to appear — skeleton now fills that same slot
              so the reveal doesn't jump. */}
          {!hero && initialLoading && <SkeletonHeroCard />}
          {hero && (
            <TouchableOpacity
              style={styles.hero}
              onPress={() => openMatchDetail(hero)}
              activeOpacity={0.88}
            >
              <View style={styles.heroTop}>
                <Text style={[styles.heroEyebrow, { color: 'rgba(255,255,255,0.75)' }]} numberOfLines={1}>
                  {isWorldCup(hero) ? 'FIFA WORLD CUP 2026' : hero.strLeague.toUpperCase()}
                </Text>
                {isLive(hero) ? (
                  <View style={[styles.livePill, { backgroundColor: theme.live }]}>
                    <View style={styles.livePillDot} />
                    <Text style={styles.livePillText}>{hero.minute ? `${hero.minute}'` : 'LIVE'}</Text>
                  </View>
                ) : !isFinished(hero) ? (
                  <View style={[styles.nextPill, { borderColor: theme.accent + '55' }]}>
                    <Text style={[styles.nextPillText, { color: theme.accent }]}>NEXT MATCH</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.heroTeams}>
                <View style={styles.heroTeamCol}>
                  <TeamBadge url={badgeUrl(hero.strHomeTeamBadge)} name={hero.strHomeTeam} abbr={teamAbbr(hero.strHomeTeam)} size={52} />
                  <Text style={styles.heroTeamName} numberOfLines={1}>{hero.strHomeTeam}</Text>
                </View>
                <View style={styles.heroMid}>
                  {hero.intHomeScore != null && hero.intAwayScore != null ? (
                    <>
                      <Text style={styles.heroScore}>{hero.intHomeScore}–{hero.intAwayScore}</Text>
                      {isFinished(hero) && <Text style={[styles.heroFt, { color: 'rgba(255,255,255,0.6)' }]}>FULL TIME</Text>}
                      {hero.lastScorer && (
                        <Text style={[styles.heroScorer, { color: 'rgba(255,255,255,0.65)' }]} numberOfLines={1}>
                          ⚽ {hero.lastScorer.name} {hero.lastScorer.minute}'
                        </Text>
                      )}
                    </>
                  ) : fmtMatchTime(hero.strTime) ? (
                    <>
                      <Text style={styles.heroTime}>{fmtMatchTime(hero.strTime)}</Text>
                      <Text style={[styles.heroTimeSub, { color: 'rgba(255,255,255,0.55)' }]}>{dateGroupLabel(hero.dateEvent)}</Text>
                    </>
                  ) : (
                    <Text style={styles.heroVs}>VS</Text>
                  )}
                </View>
                <View style={styles.heroTeamCol}>
                  <TeamBadge url={badgeUrl(hero.strAwayTeamBadge)} name={hero.strAwayTeam} abbr={teamAbbr(hero.strAwayTeam)} size={52} />
                  <Text style={styles.heroTeamName} numberOfLines={1}>{hero.strAwayTeam}</Text>
                </View>
              </View>
              <Text style={[styles.heroHint, { color: 'rgba(255,255,255,0.5)' }]}>
                {isLive(hero) ? 'Tap to predict the rest of this match →' : 'Tap to predict this match →'}
              </Text>
            </TouchableOpacity>
          )}

          {/* No model strip here — model loading lives in Coach and
              Predictor now, the two screens that actually need one.
              Matches doesn't touch the model at all. */}

          {/* Competition filter chips */}
          {comps.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <TouchableOpacity
                style={[styles.compChip, !selectedComp
                  ? { backgroundColor: theme.accent }
                  : { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }]}
                onPress={() => setSelectedComp(null)}
                activeOpacity={0.8}
              >
                <Text style={[styles.compChipText, { color: !selectedComp ? theme.accentFg : theme.textSecondary }]}>All</Text>
              </TouchableOpacity>
              {comps.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[styles.compChip, selectedComp === c
                    ? { backgroundColor: theme.accent }
                    : { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }]}
                  onPress={() => setSelectedComp(c)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.compChipText, { color: selectedComp === c ? theme.accentFg : theme.textSecondary }]} numberOfLines={1}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Quiet sync status — never a blocking error */}
          {matchFromCache && !matchOnline && updatedAgo != null && (
            <Text style={[styles.syncLine, { color: theme.textSecondary }]}>
              Offline · showing cached fixtures
            </Text>
          )}

          {/* Grouped fixture list */}
          {groups.map(g => (
            <View key={g.label}>
              <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>{g.label.toUpperCase()}</Text>
              {g.list.map(f => (
                <TouchableOpacity
                  key={f.idEvent}
                  style={[styles.fixRow, { backgroundColor: theme.card, borderColor: theme.border }]}
                  onPress={() => openMatchDetail(f)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.fixComp, { color: theme.textTertiary }]} numberOfLines={1}>{f.strLeague}</Text>
                  <View style={styles.fixTeamsRow}>
                    <View style={styles.fixTeamLeft}>
                      <TeamBadge url={badgeUrl(f.strHomeTeamBadge)} name={f.strHomeTeam} abbr={teamAbbr(f.strHomeTeam)} size={28} />
                      <Text style={[styles.fixTeamName, { color: theme.text }]} numberOfLines={1}>{f.strHomeTeam}</Text>
                    </View>
                    <View style={styles.fixMid}>
                      {f.intHomeScore != null && f.intAwayScore != null ? (
                        <>
                          <Text style={[styles.fixScore, { color: theme.text }]}>
                            {f.intHomeScore}–{f.intAwayScore}
                          </Text>
                          {isFinished(f) ? (
                            <Text style={[styles.fixStatus, { color: theme.textSecondary }]}>FT</Text>
                          ) : isLive(f) ? (
                            <Text style={[styles.fixStatus, { color: theme.live }]}>
                              {f.minute ? `${f.minute}'` : 'LIVE'}
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <Text style={[styles.fixKick, { color: theme.text }]}>{fmtMatchTime(f.strTime) || '—'}</Text>
                      )}
                    </View>
                    <View style={styles.fixTeamRight}>
                      <Text style={[styles.fixTeamName, styles.fixTeamNameRight, { color: theme.text }]} numberOfLines={1}>{f.strAwayTeam}</Text>
                      <TeamBadge url={badgeUrl(f.strAwayTeamBadge)} name={f.strAwayTeam} abbr={teamAbbr(f.strAwayTeam)} size={28} />
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              <HalfwayDivider color={theme.border} />
            </View>
          ))}

          {/* A pinned league chip (e.g. Premier League in mid-summer) can
              have nothing in the fetch window at all — without this, tapping
              it would just show a blank area under the chips with zero
              explanation. */}
          {selectedComp && fixtures.length > 0 && groups.length === 0 && hero?.strLeague !== selectedComp && (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No {selectedComp} fixtures right now</Text>
              <Text style={[styles.emptySub, { color: theme.textSecondary }]}>Check back closer to the next matchday.</Text>
            </View>
          )}

          {/* Empty state — three distinct cases: still loading (first
              fetch hasn't resolved — a shaped skeleton instead of a bare
              "Loading matches..." string), no internet at all, or online
              but our data sources are having trouble. */}
          {fixtures.length === 0 && initialLoading && <SkeletonFixtureList />}
          {fixtures.length === 0 && !initialLoading && (
            <View style={styles.empty}>
              {deviceOffline ? (
                <>
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>You're offline</Text>
                  <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
                    Connect to the internet to get live matches. Anything you've already loaded stays available offline.
                  </Text>
                </>
              ) : !matchOnline ? (
                <>
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>Having trouble connecting</Text>
                  <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
                    You're online, but match data isn't loading right now. Pull to refresh, or check back shortly.
                  </Text>
                  <ReportBugLink prefill="Matches: online but fixtures won't load" />
                </>
              ) : (
                <>
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>No fixtures synced yet</Text>
                  <Text style={[styles.emptySub, { color: theme.textSecondary }]}>Pull to refresh.</Text>
                </>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },

  // Header
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingBottom: 14,
  },
  screenTitle: { fontSize: 24, fontFamily: fonts.displayExtraBold, letterSpacing: -0.4 },
  topActions: { flexDirection: 'row', gap: 8 },
  iconChip: { width: 34, height: 34, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  // Competition chips
  chipRow: { gap: 8, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 12 },
  compChip: { borderRadius: 99, paddingHorizontal: 13, paddingVertical: 7, maxWidth: 170 },
  compChipText: { fontSize: 12, fontFamily: fonts.bodySemiBold },

  // Backdrop
  stadiumWrap: { position: 'absolute', top: 0, left: 0, right: 0, height: 350 },
  stadiumImg: { width: '100%', height: '100%' },
  // Bigger, but anchored off-corner so it stays a background accent, not a
  // page-filling element — most of it bleeds off the right/bottom edges.
  ballWrap: { position: 'absolute', right: -95, bottom: -75, width: 320, height: 320 },
  ballInner: { width: 320, height: 320, opacity: 0.9 },

  // Hero — translucent card floating over the stadium
  hero: {
    marginHorizontal: 16, marginTop: 4, borderRadius: 24, padding: 19, overflow: 'hidden', gap: 16,
    backgroundColor: 'rgba(8,10,6,0.60)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  heroEyebrow: { flex: 1, fontSize: 10, fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 1.2 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  livePillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  livePillText: { fontSize: 10.5, fontFamily: fonts.mono, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  nextPill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  nextPillText: { fontSize: 9.5, fontFamily: fonts.mono, fontWeight: '800', letterSpacing: 0.5 },
  heroTeams: { flexDirection: 'row', alignItems: 'center' },
  heroTeamCol: { flex: 1, alignItems: 'center', gap: 9 },
  heroTeamName: { fontSize: 12.5, fontFamily: fonts.displayExtraBold, color: '#f5f5f5', textTransform: 'uppercase', letterSpacing: 0.4, maxWidth: 120, textAlign: 'center' },
  heroMid: { alignItems: 'center', paddingHorizontal: 6, gap: 5 },
  heroVs: { fontSize: 18, fontFamily: fonts.displayBlack, color: 'rgba(255,255,255,0.45)' },
  heroScore: { fontSize: 42, fontFamily: fonts.displayBlack, color: '#f5f5f5', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  heroFt: { fontSize: 10, fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 1 },
  heroScorer: { fontSize: 10.5, fontFamily: fonts.bodyMedium, marginTop: 4, maxWidth: 200, textAlign: 'center' },
  heroTime: { fontSize: 30, fontFamily: fonts.displayBlack, color: '#f5f5f5', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  heroTimeSub: { fontSize: 12, fontFamily: fonts.bodyMedium },
  heroHint: { fontSize: 10.5, fontFamily: fonts.bodyMedium, textAlign: 'center' },

  syncLine: { fontSize: 11, fontFamily: fonts.bodyMedium, textAlign: 'center', marginTop: 10 },

  // Grouped fixture list
  groupLabel: { fontSize: 11, fontFamily: fonts.bodySemiBold, letterSpacing: 1.2, marginHorizontal: 20, marginTop: 18, marginBottom: 8 },
  fixRow: { marginHorizontal: 16, marginBottom: 8, borderRadius: 16, borderWidth: 1, padding: 12, gap: 8 },
  fixComp: { fontSize: 10, fontFamily: fonts.bodySemiBold, letterSpacing: 0.8, textTransform: 'uppercase' },
  fixTeamsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fixTeamLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  fixTeamRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  fixTeamName: { fontSize: 13, fontFamily: fonts.displayBold, flexShrink: 1 },
  fixTeamNameRight: { textAlign: 'right' },
  fixMid: { alignItems: 'center', minWidth: 52 },
  fixKick: { fontSize: 13, fontFamily: fonts.displayBold, fontVariant: ['tabular-nums'] },
  fixScore: { fontSize: 15, fontFamily: fonts.displayExtraBold, fontVariant: ['tabular-nums'] },
  fixStatus: { fontSize: 9, fontFamily: fonts.bodySemiBold, letterSpacing: 0.8, marginTop: 1 },

  // Empty state
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 6 },
  emptyTitle: { fontSize: 16, fontFamily: fonts.displayExtraBold },
  emptySub: { fontSize: 13, fontFamily: fonts.bodyRegular, textAlign: 'center', lineHeight: 19 },
});
