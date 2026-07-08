import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { completion, cancel, InferenceCancelledError } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import { getTheme } from '../theme';
import { fonts } from '../theme/fonts';
import { useNavigation, useRoute, useFocusEffect, StackActions } from '@react-navigation/native';
import { useTheme } from '../navigation/AppNavigator';
import { IconTarget, IconStop } from '../components/Icons';
import ScreenHeader from '../components/ScreenHeader';
import ModelStatusPill from '../components/ModelStatusPill';
import ModelPickerModal from '../components/ModelPickerModal';
import { SkeletonVerdictCard } from '../components/Skeleton';
import ReportBugLink from '../components/ReportBugLink';
import Glow from '../components/Glow';
import { TAB_BAR_HEIGHT } from '../components/TabBar';
import TeamBadge from '../components/TeamBadge';
import { llmManager } from '../utils/modelManager';
import { pickTextCapable } from '../utils/models';
import { syncModelsFromDisk, getGenParams, getDefaultModelId, getActiveFdKey, getActiveBzKey } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';
import { fetchAndCacheFixtures, isWorldCup, isLive, isFinished, fixtureOrder, fmtMatchTime as fmtTime, badgeUrl, teamAbbr, todayISO, type Fixture } from '../utils/fixtures';
import { splitChannelThinking } from '../utils/thinkingSplit';
import { createSession, addMessage, addPrediction } from '../utils/historyDb';
import { settlePendingPredictions, getPredictionRecord } from '../utils/predictionTracker';
import { fetchBothTeamForms, fetchBothSquads, formatFormContext, type TeamForm } from '../utils/teamStats';
import { fetchBothTopRatedPlayers, type RatedPlayer } from '../utils/bzzoiro';
import { matchClubs } from '../utils/topClubs';
import { logInference } from '../utils/auditLogger';

const SYSTEM_PROMPT = `You are Scout's Predictor — a veteran football analyst who ALWAYS calls the match. You never refuse, never hedge, never say you lack information. Pundits get paid to commit — so do you.

When [LIVE FORM DATA] is present, treat it as ground truth for recent form — it comes from a real-time sports data source and overrides your training assumptions. Weight it heavily alongside tactical identity, squad quality, and head-to-head history.

When [TOP RATED PLAYER] is present for a side, KEY HOME/KEY AWAY for that side MUST be exactly that named player — the rating is real data, not your guess, so do not substitute anyone else. Your job is only to write the one-clause reason he's decisive, informed by his real rating and position given. When [CURRENT SQUADS] is present instead (no rated-player data for that side), KEY HOME/KEY AWAY must name a player from that list only — never a player from your training memory who may have retired, transferred, or aged out of the squad since.

When no live data is present, commit anyway using historical record, playing style, squad depth, and tournament pedigree. Do NOT fabricate recent results — and do NOT complain about missing data. Express uncertainty ONLY through the CONFIDENCE field, never in the analysis text.

Always respond in EXACTLY this format, no deviation:

WINNER: [team name or Draw]
SCORE: [e.g. 2-1]
CONFIDENCE: [a number 40-90, the percent chance your call is right — e.g. 72]
HOME WIN: [your own estimated probability the home team wins, a number 0-100]
DRAW: [your own estimated probability of a draw, a number 0-100]
AWAY WIN: [your own estimated probability the away team wins, a number 0-100 — all three should roughly sum to 100, weighted by the actual recent-form data above when present, not just the WINNER pick]
KEY HOME: [home team's most dangerous player — the exact name from [TOP RATED PLAYER — HOME] when present — why he decides this match, one short clause]
KEY AWAY: [away team's most dangerous player — the exact name from [TOP RATED PLAYER — AWAY] when present — why he decides this match, one short clause]
---
[2-4 sentences of sharp reasoning: the tactical matchup, where the game is won and lost, and the form pattern behind your call. If live form data was provided, reference it directly. Write like a pundit making a call, not a bot citing caveats.]

Do not add anything before WINNER or after the analysis. Always respond in English.`;

// Precompiled once at module load — the old version created 5 fresh
// RegExp objects and rescanned every line on EVERY streaming flush
// (~10x/sec), which was real, measurable jank stacked on top of an
// already CPU-saturated device (llama.cpp uses every core while
// generating). Small models also drift on casing/markdown
// ("**Winner:**"), so matching stays case-insensitive and strips `**`.
const FIELD_PATTERNS: Record<string, RegExp> = {
  winner: /^winner\s*:\s*(.+)$/im,
  score: /^score\s*:\s*(.+)$/im,
  confidence: /^confidence\s*:\s*(.+)$/im,
  homeWin: /^home\s*win\s*:\s*(.+)$/im,
  draw: /^draw\s*:\s*(.+)$/im,
  awayWin: /^away\s*win\s*:\s*(.+)$/im,
  keyHome: /^key\s*home(?:\s*player)?\s*:\s*(.+)$/im,
  keyAway: /^key\s*away(?:\s*player)?\s*:\s*(.+)$/im,
};
const STRUCTURED_LINE_RE = /^(winner|score|confidence|home\s*win|draw|away\s*win|key\s*home|key\s*away)\s*:/i;
const SEPARATOR_RE = /^-{3,}\s*$/;
const STARS_RE = /\*+/g;

interface ParsedPrediction {
  winner: string; score: string; confidence: string;
  homeWin: string; draw: string; awayWin: string;
  keyHome: string; keyAway: string; analysis: string;
}

// Confidence renders as three outcome chips. The prompt asks for a number,
// but small models drift back to words — map either form, never render raw.
function confidenceParts(raw: string): { pct: number | null; word: string } {
  const m = raw.match(/(\d{1,3})/);
  let pct = m ? Math.min(95, Math.max(5, parseInt(m[1], 10))) : null;
  if (pct == null) {
    const w = raw.toLowerCase();
    pct = w.includes('high') ? 80 : w.includes('med') ? 62 : w.includes('low') ? 45 : null;
  }
  const word = pct == null ? raw : pct >= 72 ? 'High' : pct >= 55 ? 'Medium' : 'Low';
  return { pct, word };
}

// "Mbappé — pace in behind" → "Mbappé". Splits on the first spaced dash or
// comma so hyphenated surnames (Oxlade-Chamberlain) survive intact.
const playerName = (s: string) => s.split(/\s[—–-]\s|,\s|\s\(/)[0].trim();

function parsePrediction(text: string): ParsedPrediction {
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
    keyHome: field('keyHome'), keyAway: field('keyAway'), analysis,
  };
}

export default function PredictorScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  // Quick-pick suggestions while typing a manual team name — hidden once
  // the field already exactly matches one of the picks (nothing left to
  // shortcut) or once the field is empty.
  const aSuggest = useMemo(() => {
    const m = matchClubs(teamA);
    return m.some(c => c.toLowerCase() === teamA.trim().toLowerCase()) ? [] : m;
  }, [teamA]);
  const bSuggest = useMemo(() => {
    const m = matchClubs(teamB);
    return m.some(c => c.toLowerCase() === teamB.trim().toLowerCase()) ? [] : m;
  }, [teamB]);
  const [context, setContext] = useState('');
  const [prediction, setPrediction] = useState('');
  const [predictError, setPredictError] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  const [noInternet, setNoInternet] = useState(false);
  const [parsed, setParsed] = useState<{ winner: string; score: string; confidence: string; keyHome: string; keyAway: string; analysis: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [noModel, setNoModel] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pickableModels, setPickableModels] = useState<import('../types').DownloadedModel[]>([]);
  const [loadPct, setLoadPct] = useState(0);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [formA, setFormA] = useState<TeamForm | null>(null);
  const [formB, setFormB] = useState<TeamForm | null>(null);
  const [squadA, setSquadA] = useState<string[]>([]);
  const [squadB, setSquadB] = useState<string[]>([]);
  const [formLoading, setFormLoading] = useState(false);
  const [record, setRecord] = useState<{ hits: number; misses: number; pending: number } | null>(null);
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const lastHandoffRef = useRef<string | null>(null);
  const allFixturesRef = useRef<Fixture[]>([]);

  // Select a fixture handed over from the Matches tab. Runs both when
  // fixtures finish loading AND on every focus (tab screens don't remount,
  // so route.params changing is the only signal a new tap happened).
  const applyHandoff = (fixtureId: string | null | undefined) => {
    if (!fixtureId || fixtureId === lastHandoffRef.current) return;
    const f = allFixturesRef.current.find(x => x.idEvent === fixtureId);
    if (!f) return;
    lastHandoffRef.current = fixtureId;
    setTeamA(f.strHomeTeam);
    setTeamB(f.strAwayTeam);
    setSelectedFixture(f);
    setParsed(null);
    setPrediction('');
  };

  useFocusEffect(
    useCallback(() => {
      applyHandoff(route.params?.fixtureId);
    }, [route.params?.fixtureId])
  );

  // Coach and Predictor each track their own modelId, but there's only one
  // resident model app-wide — if it was stopped from Coach while this tab
  // wasn't focused, this would otherwise keep claiming "Model ready" for a
  // model that's no longer loaded.
  useFocusEffect(useCallback(() => {
    if (modelId && llmManager.getLoadedQvacId() !== modelId) {
      setModelId(null);
    }
  }, [modelId]));

  // Distinct leagues present in today's fixtures, in first-seen order (which
  // is already World-Cup-first per fixtureOrder) — pure client-side derive,
  // no new fetch. "All" is represented as selectedLeague === null.
  const leagueChips = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const f of fixtures) {
      if (f.strLeague && !seen.has(f.strLeague)) { seen.add(f.strLeague); list.push(f.strLeague); }
    }
    return list;
  }, [fixtures]);
  const visibleFixtures = useMemo(
    () => selectedLeague ? fixtures.filter(f => f.strLeague === selectedLeague) : fixtures,
    [fixtures, selectedLeague],
  );

  const currentRunRef  = useRef<any>(null);
  // Same pattern as Coach's Stop button: the SDK's cancel() can take real
  // wall-clock time to actually halt llama.cpp, so a loop-local flag makes
  // Stop feel instant regardless of how long the underlying cancel takes.
  const abortRef = useRef(false);
  const mountedRef     = useRef(true);
  const formDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelNameRef   = useRef<string>('');
  const scrollRef      = useRef<ScrollView>(null);
  const resultYRef     = useRef(0);

  // Bring the finished result into view — it renders above the CTA now,
  // but after a long form card it can still land below the fold.
  useEffect(() => {
    if (!isGenerating && parsed) {
      const t = setTimeout(() => {
        scrollRef.current?.scrollTo({ y: Math.max(0, resultYRef.current - 12), animated: true });
      }, 250);
      return () => clearTimeout(t);
    }
  }, [isGenerating, parsed]);

  // Predict button pulse while generating
  const pulsAnim = useRef(new Animated.Value(1)).current;
  // Result card reveal: scale from 0.92 + fade
  const resultScale = useRef(new Animated.Value(0.92)).current;
  const resultOpacity = useRef(new Animated.Value(0)).current;
  // Loading pulse for model warm-up

  useEffect(() => {
    mountedRef.current = true;
    loadModel();
    fetchFixtures();
    // Accountability: settle old predictions against real results, then
    // surface the running record
    (async () => {
      try { setRecord(getPredictionRecord()); } catch {}
      await settlePendingPredictions();
      if (mountedRef.current) {
        try { setRecord(getPredictionRecord()); } catch {}
      }
    })();
    // Live score ticker — refreshes the rail every 60s so simultaneous
    // live matches all update while the screen is open
    const ticker = setInterval(fetchFixtures, 60_000);
    return () => {
      mountedRef.current = false;
      clearInterval(ticker);
      clearNotification();
      if (formDebounceRef.current) clearTimeout(formDebounceRef.current);
      if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
    };
  }, []);

  // Debounced team form lookup — fires 700ms after both names reach 3+ chars
  useEffect(() => {
    if (formDebounceRef.current) clearTimeout(formDebounceRef.current);
    if (teamA.trim().length < 3 || teamB.trim().length < 3) {
      setFormA(null); setFormB(null);
      return;
    }
    formDebounceRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;  // unmounted before timeout fired
      setFormLoading(true);
      try {
        const [fdKey, bzKeyForForm] = await Promise.all([
          getActiveFdKey().catch(() => ''),
          getActiveBzKey().catch(() => ''),
        ]);
        const [[fa, fb], [sa, sb]] = await Promise.all([
          fetchBothTeamForms(teamA.trim(), teamB.trim(), fdKey, bzKeyForForm),
          fetchBothSquads(teamA.trim(), teamB.trim()),
        ]);
        if (!mountedRef.current) return;
        setFormA(fa);
        setFormB(fb);
        setSquadA(sa);
        setSquadB(sb);
      } catch {
        if (mountedRef.current) { setFormA(null); setFormB(null); setSquadA([]); setSquadB([]); }
      } finally {
        if (mountedRef.current) setFormLoading(false);
      }
    }, 700);
  }, [teamA, teamB]);


  useEffect(() => {
    if (isGenerating) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulsAnim, { toValue: 0.55, duration: 600, useNativeDriver: true }),
        Animated.timing(pulsAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])).start();
    } else {
      pulsAnim.stopAnimation();
      pulsAnim.setValue(1);
    }
  }, [isGenerating]);

  // Reveal animation when streaming finishes
  useEffect(() => {
    if (!isGenerating && prediction.length > 0) {
      resultScale.setValue(0.92);
      resultOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(resultScale, { toValue: 1, friction: 8, tension: 90, useNativeDriver: true }),
        Animated.timing(resultOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }, [isGenerating]);

  const fetchFixtures = async () => {
    try {
      const { fixtures: all, online } = await fetchAndCacheFixtures();
      if (!mountedRef.current) return;
      // World Cup owns the front of the rail (all live WC + next WC
      // kick-offs), then other leagues fill it so it never looks empty —
      // each card carries its own league name / WC badge.
      const byKickoff = (a: Fixture, b: Fixture) => fixtureOrder(a) - fixtureOrder(b);
      const wc = all.filter(isWorldCup).sort(byKickoff);
      const others = all.filter(f => !isWorldCup(f)).sort(byKickoff);
      // BUG FIX: a live match used to vanish from the rail entirely the
      // moment it crossed out of the live window — it's neither "playing"
      // nor "upcoming", and finished matches were never added to `rail` at
      // all, even though the card below already has "FT" styling ready.
      // Now: live, then upcoming, then recently finished (most recent first).
      const playing = (f: Fixture) => isLive(f);
      const upcoming = (f: Fixture) => !isLive(f) && !isFinished(f);
      const finished = (f: Fixture) => isFinished(f);
      const rail = [
        ...wc.filter(playing),
        ...wc.filter(upcoming),
        ...others.filter(playing),
        ...others.filter(upcoming),
        ...wc.filter(finished).reverse(),
        ...others.filter(finished).reverse(),
      ].slice(0, 10);
      setFixtures(rail);
      allFixturesRef.current = all;
      // Arriving from Matches: preselect the tapped fixture. Keyed by the
      // specific fixture id, not a one-shot boolean — the old boolean made
      // "quick predict" work exactly ONCE and silently ignore every later
      // tap from the Matches tab.
      applyHandoff(route.params?.fixtureId);
      setNoInternet(!online);
    } catch {
      if (mountedRef.current) setNoInternet(true);
    } finally {
      if (mountedRef.current) setFixturesLoading(false);
    }
  };

  const retryFixtures = () => {
    setFixturesLoading(true);
    setNoInternet(false);
    fetchFixtures();
  };

  const loadSpecificModel = async (model: import('../types').DownloadedModel) => {
    setLoadError(null);
    setModelLoading(true);
    setLoadPct(0);
    try {
      // projectionModelSrc keeps a multimodal model (Gemma) consistent with
      // Scout Lens — the single resident model must be loaded with its mmproj
      const mid = await llmManager.ensure(
        model,
        { ctx_size: 2048, device: 'auto', projectionModelSrc: model.projectionModelSrc },
        pct => { if (mountedRef.current) setLoadPct(Math.round(pct)); },
      );
      modelNameRef.current = model.name;
      if (mountedRef.current) { setModelId(mid); setModelLoading(false); }
    } catch (e: any) {
      // A model exists but failed to load — NOT "no model downloaded".
      if (mountedRef.current) {
        setLoadError(e?.message || 'Could not load the model. Close other apps to free memory and try again.');
        setModelLoading(false);
      }
    }
  };

  const loadModel = async () => {
    const synced = await syncModelsFromDisk();
    const model = pickTextCapable(synced, await getDefaultModelId(), llmManager.getLoadedModelId());
    if (!model) {
      if (mountedRef.current) setNoModel(true);
      return;
    }
    await loadSpecificModel(model);
  };

  // Only shows the picker when there's an actual choice (2+ text models
  // downloaded) — otherwise behaves exactly like the plain auto-pick.
  const handleLoadPress = async () => {
    const synced = await syncModelsFromDisk();
    const textModels = synced.filter(m => m.modelType === 'text');
    if (textModels.length > 1) {
      setPickableModels(textModels);
      setModelPickerOpen(true);
      return;
    }
    await loadModel();
  };

  // Coach and Predictor each track their own modelId, but there's only one
  // resident model app-wide — stopping here needs to actually free it.
  const stopModel = async () => {
    await llmManager.release();
    setModelId(null);
  };

  const predict = async () => {
    if (!teamA.trim() || !teamB.trim() || isGenerating || !modelId) return;
    setPrediction('');
    setPredictError(null);
    setParsed(null);
    setElapsed(null);
    setAnalysisOpen(false);
    setIsGenerating(true);
    abortRef.current = false;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // BUG FIX: form/squad data was fetched on a 700ms debounce tied to
    // typing, but predict() just read whatever was in formA/squadA state
    // at button-press time. Selecting a fixture from the rail fills both
    // team names instantly, and tapping "Predict Match" right after — the
    // natural, fast flow — routinely fired before that debounce finished,
    // so the prediction ran with NO grounding data and the model fell
    // back to pure hallucination (wrong "player to watch" calls). Fetch
    // fresh, guaranteed-ready data here instead of trusting the preview
    // state's timing.
    const nameA = teamA.trim();
    const nameB = teamB.trim();
    setFormLoading(true);
    const [fdKey, bzKey] = await Promise.all([
      getActiveFdKey().catch(() => ''),
      getActiveBzKey().catch(() => ''),
    ]);
    // Hard ceiling on grounding data — fetchBothTeamForms can chain through
    // three fallback sources (Bzzoiro, football-data.org, TheSportsDB),
    // and TheSportsDB's own path alone is three sequential 6s-timeout
    // calls per team. For a team none of them cover (youth/lower-league),
    // that stacks up to 20-30s of dead air before the model call even
    // starts — which is indistinguishable from "predictor is broken" even
    // though it's just grounding data quietly exhausting every fallback.
    // Racing against a fixed timeout means the model always starts
    // promptly; the underlying calls still finish in the background and
    // get picked up naturally next time, they just don't block this run.
    const withDeadline = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))]);
    const [[freshFormA, freshFormB], [freshSquadA, freshSquadB], [ratedA, ratedB]] = await Promise.all([
      withDeadline(
        fetchBothTeamForms(nameA, nameB, fdKey, bzKey).catch(() => [formA, formB] as [TeamForm | null, TeamForm | null]),
        6000,
        [formA, formB] as [TeamForm | null, TeamForm | null],
      ),
      withDeadline(
        fetchBothSquads(nameA, nameB).catch(() => [squadA, squadB] as [string[], string[]]),
        6000,
        [squadA, squadB] as [string[], string[]],
      ),
      // Real 0-99 player ratings from Bzzoiro — this is what actually picks
      // KEY HOME/KEY AWAY now (highest-rated player on each squad), not the
      // model guessing off a bare name list. Only runs when a Bzzoiro key
      // is active; falls back to the squad-list mechanism below otherwise.
      withDeadline(
        bzKey ? fetchBothTopRatedPlayers(bzKey, nameA, nameB).catch(() => [null, null] as [RatedPlayer | null, RatedPlayer | null]) : Promise.resolve([null, null] as [RatedPlayer | null, RatedPlayer | null]),
        6000,
        [null, null] as [RatedPlayer | null, RatedPlayer | null],
      ),
    ]);
    setFormA(freshFormA); setFormB(freshFormB);
    setSquadA(freshSquadA); setSquadB(freshSquadB);
    setFormLoading(false);
    if (!mountedRef.current) return;

    const formBlock = (freshFormA || freshFormB)
      ? formatFormContext(nameA, freshFormA, nameB, freshFormB) + '\n\n'
      : '';
    // Real rating data takes priority per side — only falls back to the
    // weaker "pick from this name list" mechanism for a side Bzzoiro's
    // player database doesn't cover.
    const ratedLine = (label: string, p: RatedPlayer | null) =>
      p ? `[TOP RATED PLAYER — ${label}] ${p.name} (${p.position}${p.nationality ? ', ' + p.nationality : ''}) — Rating: ${p.rating}/99\n` : '';
    const ratedBlock = (ratedA || ratedB) ? `${ratedLine('HOME', ratedA)}${ratedLine('AWAY', ratedB)}\n` : '';
    // Real current squad names, so KEY HOME/KEY AWAY names a player who's
    // actually still on the team instead of whoever the model remembers
    // from training (verified: defaulted to Neymar for Brazil, who hasn't
    // been part of the squad picture in years). Only included per side
    // without a rated-player hit above, since that's strictly better.
    const squadBlock = ((!ratedA && freshSquadA.length > 0) || (!ratedB && freshSquadB.length > 0))
      ? `[CURRENT SQUADS — pick KEY HOME/KEY AWAY only from these names]\n`
        + (!ratedA ? `${nameA}: ${freshSquadA.length > 0 ? freshSquadA.join(', ') : 'not found'}\n` : '')
        + (!ratedB ? `${nameB}: ${freshSquadB.length > 0 ? freshSquadB.join(', ') : 'not found'}\n` : '')
        + `[END SQUADS]\n\n`
      : '';
    const userContext = context.trim() ? `\n\nAdditional context: ${context.trim()}` : '';
    const prompt = `${ratedBlock}${squadBlock}${formBlock}Predict: ${nameA} vs ${nameB}${userContext}`;
    const genStart = Date.now();

    try {
      const gp = await getGenParams();
      const run = completion({
        modelId,
        history: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        stream: true,
        captureThinking: false,
        generationParams: {
          predict: 380,
          temp: gp.temp,
          top_k: gp.top_k,
          top_p: gp.top_p,
          repeat_penalty: gp.repeat_penalty,
          reasoning_budget: 0 as 0,
        },
      });
      currentRunRef.current = run;
      registerInferenceCancel(() => {
        abortRef.current = true;
        if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
      });
      showRunningNotification('Predictor');

      // Predictor has no Think mode, but some models (Gemma) still emit
      // reasoning as literal "<|channel>thought...channel|>" text even with
      // reasoning_budget: 0 — strip it so it never pollutes the prediction.
      let raw = '';
      let lastFlush = 0;
      for await (const event of run.events) {
        if (abortRef.current) break;
        if (event.type === 'contentDelta') {
          raw += event.text;
          const { answer } = splitChannelThinking(raw);
          const now = Date.now();
          if (mountedRef.current && now - lastFlush > 100) {
            lastFlush = now;
            setPrediction(answer);
          }
        }
      }
      currentRunRef.current = null;
      clearNotification();
      if (abortRef.current) {
        // Stopped mid-stream — no result page, no history entry, just
        // back to a clean idle state (matches the disabled/Predict Again
        // spot the button would be in otherwise).
        if (mountedRef.current) { setIsGenerating(false); setPrediction(''); }
        return;
      }
      const streamed = splitChannelThinking(raw).answer;
      if (mountedRef.current) setPrediction(streamed);
      const [, stats] = await Promise.all([run.final, run.stats]);

      const totalMs = Date.now() - genStart;
      logInference('predictor', modelNameRef.current, stats?.timeToFirstToken ?? 0, totalMs, stats?.generatedTokens ?? 0).catch(() => {});

      // Save prediction to SQLite history
      if (streamed) {
        try {
          const sessionId = createSession('predictor', `${teamA} vs ${teamB}`);
          const historyPrompt = context.trim()
            ? `${teamA} vs ${teamB}\n\nContext: ${context.trim()}`
            : `${teamA} vs ${teamB}`;
          addMessage(sessionId, 'user', historyPrompt);
          addMessage(sessionId, 'assistant', streamed);
        } catch {}
      }

      if (mountedRef.current) {
        const secs = Math.round((Date.now() - genStart) / 100) / 10;
        setElapsed(secs);
        const p = parsePrediction(streamed);
        setParsed(p);
        // Record the call for the accountability track record
        if (p.winner) {
          try {
            addPrediction(teamA.trim(), teamB.trim(), p.winner, p.score, p.confidence);
            setRecord(getPredictionRecord());
          } catch {}
        }
        setIsGenerating(false);
        setPrediction('');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // The result gets its own page — verdict + analysis with a back
        // button, instead of rendering under the fold on this screen.
        navigation.navigate('PredictionResult', {
          teamA: teamA.trim(), teamB: teamB.trim(),
          winner: p.winner, score: p.score, confidence: p.confidence,
          homeWin: p.homeWin, draw: p.draw, awayWin: p.awayWin,
          keyHome: p.keyHome, keyAway: p.keyAway, analysis: p.analysis,
          // Real ratings, sourced directly — not re-parsed from the
          // model's own text, so the number shown is always exactly what
          // Bzzoiro's player data actually says, regardless of how the
          // model phrases its reasoning around it.
          homeRating: ratedA?.rating ?? null, awayRating: ratedB?.rating ?? null,
          elapsed: secs,
        });
      }
    } catch (err) {
      currentRunRef.current = null;
      clearNotification();
      if (mountedRef.current) {
        // BUG FIX: this used to setPrediction(...) with the error text, but
        // every render path that shows `prediction` requires isGenerating
        // to still be true — which it isn't by the time this runs — so the
        // message was set but never actually appeared. The button just
        // silently went back to "Predict Match" with zero explanation.
        if (!(err instanceof InferenceCancelledError)) {
          setPredictError(err instanceof Error ? err.message : 'Prediction failed. Try again.');
        }
        setIsGenerating(false);
      }
    }
  };

  const stopPrediction = () => {
    abortRef.current = true;
    if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
  };

  // Only recomputed when the streamed text actually grows — a re-render
  // triggered by anything else (e.g. the pulse animation) reuses this
  const live = useMemo(() => parsePrediction(prediction), [prediction]);

  const accent = theme.accent;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScreenHeader
        title="Predictor"
        centered
        onBack={false}
        titleExtra={
          record && record.hits + record.misses > 0 ? (
            <View style={[styles.recordChip, { backgroundColor: accent + '16' }]}>
              <Text style={[styles.recordChipText, { color: accent }]}>
                {record.hits}W · {record.misses}L
              </Text>
            </View>
          ) : undefined
        }
        rightSlot={
          <>
            <TouchableOpacity
              onPress={() => navigation.dispatch(StackActions.push('History', { tab: 'predictor' }))}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.historyBtn, { color: theme.textSecondary }]}>History</Text>
            </TouchableOpacity>
          </>
        }
      />

      <ModelStatusPill
        noModel={noModel}
        modelLoading={modelLoading}
        loadError={loadError}
        modelId={modelId}
        loadPct={loadPct}
        onLoad={handleLoadPress}
        onStop={stopModel}
        onGetModel={() => navigation.navigate('Models')}
      />

      <ModelPickerModal
        visible={modelPickerOpen}
        models={pickableModels}
        currentModelId={modelId}
        onSelect={loadSpecificModel}
        onClose={() => setModelPickerOpen(false)}
      />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 36 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* No fixture carousel here — Matches is where you browse fixtures;
            tapping one there hands it over ("quick predict"). Either the
            confirmation card shows (fixture picked) OR the manual inputs
            show — never both, so the same matchup never appears twice. */}
        {selectedFixture ? (
          <View style={[styles.selCard, { backgroundColor: theme.card, borderColor: accent + '55' }]}>
            <View style={styles.selTop}>
              <Text style={[styles.selLeague, { color: theme.textTertiary }]} numberOfLines={1}>
                {selectedFixture.strLeague}
              </Text>
              {!isLive(selectedFixture) && !isFinished(selectedFixture) && fmtTime(selectedFixture.strTime) ? (
                <Text style={[styles.selTime, { color: accent }]}>
                  {selectedFixture.dateEvent && selectedFixture.dateEvent !== todayISO()
                    ? `${new Date(selectedFixture.dateEvent).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${fmtTime(selectedFixture.strTime)}`
                    : `Today · ${fmtTime(selectedFixture.strTime)}`}
                </Text>
              ) : selectedFixture.intHomeScore != null ? (
                <Text style={[styles.selTime, { color: theme.textSecondary }]}>
                  {isFinished(selectedFixture) ? 'FT ' : ''}{selectedFixture.intHomeScore}-{selectedFixture.intAwayScore}
                </Text>
              ) : null}
            </View>
            <View style={styles.selTeams}>
              <TeamBadge url={badgeUrl(selectedFixture.strHomeTeamBadge)} name={selectedFixture.strHomeTeam} abbr={teamAbbr(selectedFixture.strHomeTeam)} size={28} />
              <Text style={[styles.selVs, { color: theme.text }]} numberOfLines={1}>
                {selectedFixture.strHomeTeam}  vs  {selectedFixture.strAwayTeam}
              </Text>
              <TeamBadge url={badgeUrl(selectedFixture.strAwayTeamBadge)} name={selectedFixture.strAwayTeam} abbr={teamAbbr(selectedFixture.strAwayTeam)} size={28} />
            </View>
            <TouchableOpacity
              onPress={() => { setSelectedFixture(null); setTeamA(''); setTeamB(''); setParsed(null); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.selHint, { color: accent }]}>Not this match? Pick teams manually</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <View style={styles.matchup}>
              <View style={[styles.teamCard, { backgroundColor: theme.card, borderWidth: 1, borderColor: teamA.trim() ? accent : theme.border }]}>
                <Text style={[styles.teamCardLabel, { color: theme.textSecondary }]}>Home</Text>
                <TextInput
                  style={[styles.teamInput, { color: theme.text }]}
                  placeholder="e.g. Arsenal"
                  placeholderTextColor={theme.textTertiary}
                  value={teamA}
                  onChangeText={t => { setTeamA(t); setParsed(null); }}
                  returnKeyType="next"
                />
              </View>
              <Text style={[styles.vsChip, { color: theme.textTertiary }]}>VS</Text>
              <View style={[styles.teamCard, { backgroundColor: theme.card, borderWidth: 1, borderColor: teamB.trim() ? accent : theme.border }]}>
                <Text style={[styles.teamCardLabel, { color: theme.textSecondary }]}>Away</Text>
                <TextInput
                  style={[styles.teamInput, { color: theme.text }]}
                  placeholder="e.g. Real Madrid"
                  placeholderTextColor={theme.textTertiary}
                  value={teamB}
                  onChangeText={t => { setTeamB(t); setParsed(null); }}
                  returnKeyType="done"
                />
              </View>
            </View>

            {/* Quick-pick from a hardcoded top-club/national-team list —
                filters as you type, tap to fill instead of spelling the
                exact name. Hidden once the field already matches a pick. */}
            {aSuggest.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestRow}>
                {aSuggest.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.suggestChip, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}
                    onPress={() => { setTeamA(c); setParsed(null); }}
                  >
                    <Text style={[styles.suggestChipText, { color: theme.text }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {bSuggest.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestRow}>
                {bSuggest.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.suggestChip, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}
                    onPress={() => { setTeamB(c); setParsed(null); }}
                  >
                    <Text style={[styles.suggestChipText, { color: theme.text }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* Immediate feedback — visible from the instant Predict is pressed
            until the first token arrives, so the wait never looks frozen.
            Was a plain "ANALYZING THE MATCHUP..." text block floating over
            an otherwise empty screen — a skeleton shaped like the verdict
            card that's about to land reads as content already arriving. */}
        {isGenerating && prediction.length === 0 && <SkeletonVerdictCard />}

        {/* Streaming result — parsed live so raw WINNER:/SCORE: lines never
            show; fields pop in as chips, analysis streams below. Team
            badges + VS header reuses the same shape as the skeleton above
            and the verdict card that follows on the result page, so the
            three states read as one continuous reveal instead of three
            unrelated layouts. */}
        {isGenerating && prediction.length > 0 && (
          <View style={[styles.resultCard, { backgroundColor: theme.card }]}>
              <View style={styles.resultContent}>
                <View style={styles.streamHeaderRow}>
                  <TeamBadge url={badgeUrl(selectedFixture?.strHomeTeamBadge)} name={teamA} abbr={teamAbbr(teamA)} size={28} />
                  <Text style={[styles.resultLabel, { color: accent }]}>MAKING THE CALL...</Text>
                  <TeamBadge url={badgeUrl(selectedFixture?.strAwayTeamBadge)} name={teamB} abbr={teamAbbr(teamB)} size={28} />
                </View>
                {(live.winner || live.score || live.confidence) && (
                  <View style={styles.liveChipsRow}>
                    {live.winner ? (
                      <View style={[styles.liveFieldChip, { backgroundColor: accent + '18' }]}>
                        <Text style={[styles.liveFieldChipText, { color: accent }]}>{live.winner}</Text>
                      </View>
                    ) : null}
                    {live.score ? (
                      <View style={[styles.liveFieldChip, { backgroundColor: theme.cardAlt }]}>
                        <Text style={[styles.liveFieldChipText, { color: theme.text }]}>{live.score}</Text>
                      </View>
                    ) : null}
                    {live.confidence ? (
                      <View style={[styles.liveFieldChip, { backgroundColor: theme.cardAlt }]}>
                        <Text style={[styles.liveFieldChipText, { color: theme.textSecondary }]}>
                          {confidenceParts(live.confidence).pct != null ? `${confidenceParts(live.confidence).pct}%` : live.confidence}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
                {live.analysis ? (
                  <Text style={[styles.resultText, { color: theme.text }]}>{live.analysis}</Text>
                ) : null}
              </View>
            </View>
        )}

        {predictError && !isGenerating && (
          <View style={[styles.predictErrorCard, { backgroundColor: theme.card, borderColor: theme.error + '40' }]}>
            <Text style={[styles.predictErrorText, { color: theme.error }]}>{predictError}</Text>
            <ReportBugLink prefill={`Predictor failed: ${predictError}`} />
          </View>
        )}

        {/* Predict / Stop button — label flips to Predict Again after a result */}
        <Animated.View style={{ opacity: pulsAnim }}>
          <TouchableOpacity
            // Mock's off state: dim surface + mist text, not a faded volt
            style={[styles.predictBtn,
              isGenerating ? { backgroundColor: theme.error }
              : (teamA.trim() && teamB.trim() && modelId) ? { backgroundColor: accent }
              : { backgroundColor: theme.cardAlt, borderWidth: 1, borderColor: theme.border },
            ]}
            onPress={isGenerating ? stopPrediction : predict}
            disabled={!isGenerating && (!teamA.trim() || !teamB.trim() || !modelId)}
            activeOpacity={0.82}
          >
            {isGenerating ? (
              <View style={styles.btnInner}>
                <IconStop size={18} color="#fff" />
                <Text style={[styles.predictBtnText, { color: '#fff' }]}>Stop</Text>
              </View>
            ) : (() => {
              const ready = !!(teamA.trim() && teamB.trim() && modelId);
              const fg = ready ? theme.accentFg : theme.textSecondary;
              return (
                <View style={styles.btnInner}>
                  <IconTarget size={18} color={fg} />
                  <Text style={[styles.predictBtnText, { color: fg }]}>
                    {parsed ? 'Predict Again' : 'Predict Match'}
                  </Text>
                </View>
              );
            })()}
          </TouchableOpacity>
        </Animated.View>

        {/* Full data-source attribution now lives once, on the result page
            you land on right after predicting — showing the same line
            again here, before you've even predicted anything, was just
            repetition across a two-screen flow. */}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  recordChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  recordChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  historyBtn: { fontSize: 12, fontWeight: '600' },
  // No flexGrow: 1 — with the fixture carousel, form-guide dots, context
  // input, and action row all removed, the content is now much shorter
  // than the screen, and flexGrow forced it to stretch, leaving a stray
  // block of empty space at the bottom. Sized to its own content instead.
  content: { padding: 16, gap: 16 },
  matchup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Fixtures
  fixturesSection: { gap: 10 },
  fixturesHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  fixturesSectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  fixturesTodayLabel: { fontSize: 10, fontWeight: '500', marginTop: 1 },
  apiDisclosure: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  apiDisclosureText: { fontSize: 9, fontWeight: '600' },
  fixturesLoading: { fontSize: 13, fontStyle: 'italic' },
  fixturesScroll: { gap: 8, paddingBottom: 2 },
  leagueChipRow: { gap: 6, paddingBottom: 8 },
  leagueChip: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 160 },
  leagueChipText: { fontSize: 11, fontWeight: '700' },
  fixtureCard: { width: 152, borderRadius: 12, padding: 12, gap: 3 },
  wcBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 2 },
  wcBadgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  fixtureLeague: { fontSize: 9, fontWeight: '600', letterSpacing: 0.3 },
  fixtureTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fixtureBadge: { width: 20, height: 20 },
  fixtureBadgeFallback: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fixtureBadgeMono: { fontSize: 7, fontWeight: '800', letterSpacing: 0.2 },
  fixtureHome: { fontSize: 13, fontWeight: '700', flex: 1 },
  fixtureVs: { fontSize: 10, marginLeft: 26 },
  fixtureScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 26 },
  fixtureScore: { fontSize: 14, fontWeight: '900', letterSpacing: 0.3 },
  fixtureStatus: { fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  fixtureAway: { fontSize: 13, fontWeight: '700', flex: 1 },
  fixtureTime: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  // Disclosure

  teamCard: {
    flex: 1, borderRadius: 14, padding: 14,
    gap: 4, minHeight: 80,
  },
  teamCardLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  teamInput: { fontSize: 15, fontWeight: '700', paddingTop: 2 },
  contextInput: {
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, lineHeight: 20, minHeight: 60,
  },
  // The ONE prediction card
  matchDetails: { borderRadius: 18, padding: 14, gap: 12 },
  matchDetailsTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  matchDetailsLeague: { flex: 1, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  matchDetailsTime: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  matchDetailsTeams: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  matchDetailsBadge: { width: 26, height: 26 },
  matchDetailsMono: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  matchDetailsVs: { flex: 1, fontSize: 15, fontFamily: fonts.displayExtraBold, textAlign: 'center' },

  // Selected-match confirmation card (handed over from Matches)
  selCard: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  selTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  selLeague: { flex: 1, fontSize: 10, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, textTransform: 'uppercase' },
  selTime: { fontSize: 11, fontFamily: fonts.mono, fontWeight: '800', fontVariant: ['tabular-nums'] },
  selTeams: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selVs: { flex: 1, fontSize: 15, fontFamily: fonts.displayExtraBold, textAlign: 'center' },
  selHint: { fontSize: 11, fontFamily: fonts.bodySemiBold, textAlign: 'center' },
  vsChip: { fontSize: 10, fontFamily: fonts.mono, fontWeight: '800' },
  suggestRow: { gap: 6, paddingHorizontal: 2 },
  suggestChip: { borderRadius: 999, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 12 },
  suggestChipText: { fontSize: 12, fontFamily: fonts.bodySemiBold },

  // Verdict card (v3 — the call)
  verdict: { borderRadius: 24, borderWidth: 1, padding: 20, overflow: 'hidden', marginBottom: 4 },
  verdictTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 14 },
  verdictSide: { flex: 1, maxWidth: 110, alignItems: 'center', gap: 7 },
  verdictDisc: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center' },
  verdictDiscText: { fontSize: 10, fontFamily: fonts.displayExtraBold, color: '#0b0b0b' },
  verdictName: { fontSize: 10, fontFamily: fonts.displayBold, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center' },
  verdictVs: { fontSize: 10, fontFamily: fonts.mono, fontWeight: '800', marginTop: 10 },
  verdictEyebrow: { textAlign: 'center', fontSize: 10, fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 2, marginTop: 18, marginBottom: 8 },
  verdictHeadline: { fontSize: 26, fontFamily: fonts.displayBlack, lineHeight: 29, letterSpacing: -0.5, textAlign: 'center', marginBottom: 4 },
  mlsLine: { textAlign: 'center', fontSize: 11, fontFamily: fonts.bodySemiBold, marginBottom: 16 },
  mlsScore: { fontSize: 13, fontFamily: fonts.mono, fontWeight: '800', fontVariant: ['tabular-nums'] },
  outcomeRow: { flexDirection: 'row', gap: 8 },
  outcomeChip: { flex: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center' },
  ocPct: { fontSize: 16, fontFamily: fonts.mono, fontWeight: '800', fontVariant: ['tabular-nums'] },
  ocLabel: { fontSize: 9, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 5 },

  analysisLabel: { fontSize: 9.5, fontFamily: fonts.mono, fontWeight: '700', letterSpacing: 1.5, marginTop: 10, marginBottom: 8 },
  keyLine: { fontSize: 11.5, lineHeight: 17, marginBottom: 8 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 13, borderWidth: 1 },

  // Form band (inside the prediction card)
  formBand: { borderTopWidth: 1, paddingTop: 12, gap: 10 },
  formLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  fdUpsell: { marginTop: 4 },
  fdUpsellText: { fontSize: 11, lineHeight: 16 },
  formRows: { gap: 8 },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 26 },
  formTeamName: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, width: 74 },
  formDots: { flexDirection: 'row', gap: 5 },
  formDotCircle: {
    width: 24, height: 24, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
  },
  formDotText: { fontSize: 10, fontWeight: '800' },
  formLastResult: { flex: 1, fontSize: 11, textAlign: 'right', fontVariant: ['tabular-nums'] },
  vsBox: {
    width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  vsText: { fontSize: 11, fontWeight: '800' },
  predictErrorCard: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 },
  predictErrorText: { fontSize: 13, fontFamily: fonts.bodyMedium },
  predictBtn: {
    borderRadius: 14, paddingVertical: 17, alignItems: 'center', justifyContent: 'center',
  },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  predictBtnText: { fontSize: 16, fontWeight: '800' },
  resultCard: { borderRadius: 14, overflow: 'hidden' },
  resultContent: { flex: 1, padding: 16, gap: 8 },
  resultLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  streamHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 4 },
  resultText: { fontSize: 15, lineHeight: 24 },
  stat: { fontSize: 10 },
  analysisHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  analysisActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  copyBtn: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  // Scoreboard
  scoreboard: { borderRadius: 16, marginBottom: 10, overflow: 'hidden' },
  scoreboardTop: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1,
  },
  scoreboardLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  confBlock: { paddingHorizontal: 16, paddingBottom: 14, gap: 6 },
  confBar: { height: 6, borderRadius: 99, overflow: 'hidden' },
  confBarFill: { height: '100%', borderRadius: 99 },
  confText: { fontSize: 10.5, fontWeight: '700' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 8 },
  scoreTeam: { flex: 1, alignItems: 'flex-start', gap: 6 },
  scoreTeamRight: { alignItems: 'flex-end' },
  scoreTeamName: { fontSize: 14, fontFamily: fonts.displayBold, lineHeight: 19 },
  winnerTag: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  winnerTagText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  scoreCenter: { alignItems: 'center', minWidth: 88 },
  scoreText: { fontSize: 48, fontFamily: fonts.displayBlack, letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  scoreVs: { fontSize: 14, fontWeight: '700' },
  analysisCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  keyPlayersCard: { borderRadius: 14, padding: 14, gap: 9, marginBottom: 10 },
  liveChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  liveFieldChip: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  liveFieldChipText: { fontSize: 12, fontWeight: '700' },
  keyPlayerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  keyPlayerDot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 5 },
  keyPlayerText: { flex: 1, fontSize: 13, lineHeight: 19 },
});
