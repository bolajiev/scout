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
import { AVAILABLE_MODELS, pickTextCapable } from '../utils/models';
import type { ModelInfo } from '../types';
import { syncModelsFromDisk, getGenParams, getDefaultModelId, setDefaultModelId, getActiveFdKey, getActiveBzKey } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';
import { fetchAndCacheFixtures, isWorldCup, isLive, isFinished, fixtureOrder, fmtMatchTime as fmtTime, badgeUrl, teamAbbr, todayISO, type Fixture } from '../utils/fixtures';
import { splitChannelThinking } from '../utils/thinkingSplit';
import { createPredictionSession, addPrediction } from '../utils/historyDb';
import { settlePendingPredictions, getPredictionRecord } from '../utils/predictionTracker';
import { fetchBothTeamForms, formatFormContext, type TeamForm } from '../utils/teamStats';
import { parsePrediction } from '../utils/predictionParser';
import { matchClubs } from '../utils/topClubs';
import { logInference } from '../utils/auditLogger';

const SYSTEM_PROMPT = `You are Scout's Predictor, a veteran football analyst — always call the match, never refuse or hedge. Draw is a real result, not a hedge.

Recent form data is real, current data — weight it heavily.

Respond in EXACTLY this format — every field required:

WINNER: [team name or Draw]
SCORE: [e.g. 2-1]
CONFIDENCE: [40-90]
HOME WIN: [0-100 — weighted by form data]
DRAW: [0-100 — Draw is always possible, assign a real number]
AWAY WIN: [0-100 — HOME WIN, DRAW, and AWAY WIN must be three clearly different numbers (e.g. 55-25-20 not 45-10-45) that sum to 95-105]
---
[Mandatory — 2-4 sentences of sharp reasoning: tactical matchup, where the game is won and lost, form pattern. Write like a pundit, not a bot.]

Do not add anything before WINNER or after the analysis. Always respond in English.`;

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
  const [parsed, setParsed] = useState<{ winner: string; score: string; confidence: string; analysis: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [noModel, setNoModel] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pickableModels, setPickableModels] = useState<ModelInfo[]>([]);
  const [downloadedModelIds, setDownloadedModelIds] = useState<Set<string>>(new Set());
  const [loadPct, setLoadPct] = useState(0);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [formA, setFormA] = useState<TeamForm | null>(null);
  const [formB, setFormB] = useState<TeamForm | null>(null);
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
    // BUG FIX: switching to a different fixture (tapping a match card
    // elsewhere while a prediction is still streaming for the current
    // one) used to yank the on-screen teams/badges to the new fixture
    // immediately — then, when the OLD generation finished, it still
    // navigated to PredictionResult with the OLD (now off-screen) team
    // names, landing the user on a result page for a match they'd
    // already moved away from. Deliberately not marking fixtureId as
    // handled here (lastHandoffRef stays put) — if it's still the
    // intended target once generation ends, tapping it again picks it
    // up normally instead of ever silently dropping it.
    if (isGenerating) return;
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
        const [[fa, fb]] = await Promise.all([
          fetchBothTeamForms(teamA.trim(), teamB.trim(), fdKey, bzKeyForForm),
        ]);
        if (!mountedRef.current) return;
        setFormA(fa);
        setFormB(fb);
      } catch {
        if (mountedRef.current) { setFormA(null); setFormB(null); }
      } finally {
        if (mountedRef.current) setFormLoading(false);
      }
    }, 700);
  }, [teamA, teamB]);


  // BUG FIX: this used to pulse continuously the whole time isGenerating
  // was true — but that's also the entire time the button reads "Stop",
  // so a long prediction meant the Stop button itself sat there blinking
  // for the whole wait, distracting during exactly the moment someone's
  // staring at the screen the most. No longer pulses at all.

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
    const defaultId = await getDefaultModelId();
    const model = pickTextCapable(synced, defaultId, llmManager.getLoadedModelId());
    if (!model) {
      // No downloaded model at all — open picker so user can see what's
      // available and tap Get to navigate to Models.
      const downloadedIds = new Set(synced.map(m => m.id));
      setDownloadedModelIds(downloadedIds);
      setPickableModels(AVAILABLE_MODELS);
      setModelPickerOpen(true);
      return;
    }
    await loadSpecificModel(model);
  };

  // Picking from the modal (proactive first-load prompt or a manual
  // re-pick) sets that choice as the ongoing default too — otherwise the
  // silent auto-pick path above would go right back to asking, or worse,
  // silently reverting to whatever pickTextCapable's own fallback prefers.
  const selectModel = async (model: ModelInfo) => {
    await setDefaultModelId(model.id).catch(() => {});
    const synced = await syncModelsFromDisk();
    const full = synced.find(m => m.id === model.id);
    setModelPickerOpen(false);
    if (full) await loadSpecificModel(full);
  };

  // Opens the model picker with ALL models — downloaded ones load on tap,
  // non-downloaded ones navigate to Models screen.
  const handlePickModel = async () => {
    const synced = await syncModelsFromDisk();
    const downloadedIds = new Set(synced.map(m => m.id));
    setDownloadedModelIds(downloadedIds);
    setPickableModels(AVAILABLE_MODELS);
    setModelPickerOpen(true);
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
    // typing, but predict() just read whatever was in formA state at
    // button-press time. Selecting a fixture from the rail fills both
    // team names instantly, and tapping "Predict Match" right after — the
    // natural, fast flow — routinely fired before that debounce finished,
    // so the prediction ran with NO grounding data. Fetch fresh,
    // guaranteed-ready data here instead of trusting the preview state.
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
    const [[freshFormA, freshFormB]] = await Promise.all([
      withDeadline(
        fetchBothTeamForms(nameA, nameB, fdKey, bzKey).catch(() => [formA, formB] as [TeamForm | null, TeamForm | null]),
        6000,
        [formA, formB] as [TeamForm | null, TeamForm | null],
      ),
    ]);
    setFormA(freshFormA); setFormB(freshFormB);
    setFormLoading(false);
    if (!mountedRef.current) return;

    const formBlock = (freshFormA || freshFormB)
      ? formatFormContext(nameA, freshFormA, nameB, freshFormB) + '\n\n'
      : '';
    const userContext = context.trim() ? `\n\nAdditional context: ${context.trim()}` : '';
    const prompt = `${formBlock}Predict: ${nameA} vs ${nameB}${userContext}`;
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
          // Floor at 512 ensures structured fields + analysis always fit.
          // Cap at 1024 respects ctx_size ~2048 (system prompt + context
          // already take ~600-1000 tokens, leaving ~1000 for output).
          predict: Math.min(Math.max(gp.maxTokens, 512), 1024),
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

      // Save prediction to SQLite history — session + both messages in one
      // transaction now (see createPredictionSession), so a save failure
      // can't leave an orphaned title-only session with no content behind.
      if (streamed) {
        try {
          const historyPrompt = context.trim()
            ? `${teamA} vs ${teamB}\n\nContext: ${context.trim()}`
            : `${teamA} vs ${teamB}`;
          await createPredictionSession(`${teamA} vs ${teamB}`, historyPrompt, streamed);
        } catch {}
      }

      if (mountedRef.current) {
        const secs = Math.round((Date.now() - genStart) / 100) / 10;
        setElapsed(secs);
        const p = parsePrediction(streamed);
        setParsed(p);
        // BUG FIX: same dead-end already fixed in Coach — a model can burn
        // its entire token budget on hidden reasoning (reasoning_budget: 0
        // doesn't guarantee compliance) and leave nothing real behind.
        // This used to navigate to PredictionResult unconditionally, a
        // completely blank verdict card with zero explanation. Show an
        // honest retry prompt on THIS screen instead of a broken page.
        if (!p.winner) {
          setIsGenerating(false);
          setPrediction('');
          setPredictError("Didn't get a usable prediction — try again.");
          return;
        }
        // Record the call for the accountability track record — a failure
        // here means this prediction can never be graded (permanently
        // missing from the W/L record with no way to know), so at least
        // surface it instead of swallowing it silently.
        try {
          await addPrediction(teamA.trim(), teamB.trim(), p.winner, p.score, p.confidence);
          setRecord(getPredictionRecord());
        } catch (e) {
          console.warn('[Predictor] addPrediction failed — this call will never be graded:', e);
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
          analysis: p.analysis,
          elapsed: secs,
          device: stats?.backendDevice,
          modelName: modelNameRef.current || undefined,
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
  // BUG FIX: parsing the raw in-progress tail line caused fields to
  // visibly flicker — e.g. "KEY AWAY" streams in before its colon/value
  // does, doesn't match a structured field yet so it briefly leaked into
  // the live analysis text, then vanished the instant the value completed
  // and it got recognized as a real field. Only complete, newline-
  // terminated lines get parsed while still streaming; the line actively
  // being typed just isn't shown yet until it's finished.
  const live = useMemo(() => {
    const safeText = isGenerating && !prediction.endsWith('\n')
      ? prediction.slice(0, prediction.lastIndexOf('\n') + 1)
      : prediction;
    return parsePrediction(safeText);
  }, [prediction, isGenerating]);

  const accent = theme.accent;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.background }]}
      behavior="padding"
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
        modelName={modelNameRef.current}
        loadPct={loadPct}
        onPickModel={handlePickModel}
        onStop={stopModel}
        onGetModel={() => navigation.navigate('Models')}
      />

      <ModelPickerModal
        visible={modelPickerOpen}
        models={pickableModels}
        downloadedIds={downloadedModelIds}
        currentModelId={modelId}
        onSelect={selectModel}
        onGetModel={() => { setModelPickerOpen(false); navigation.navigate('Models'); }}
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
                  editable={!isGenerating}
                  // BUG FIX: Android's autofill suggestion strip renders in
                  // the OS's own (often light) theme, independent of the
                  // app's dark theme — the actual source of the white strip
                  // that appeared while typing (same fix as Coach's input).
                  importantForAutofill="no"
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
                  editable={!isGenerating}
                  importantForAutofill="no"
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

        {/* Streaming result — team badges + MAKING THE CALL header,
            then the analysis text streaming in as the model writes it.
            No chips during generation (winner/score/confidence pop in
            once on the result page) — the raw structured lines are
            parsed invisibly and forwarded to PredictionResult. */}
        {isGenerating && prediction.length > 0 && (
          <View style={[styles.resultCard, { backgroundColor: theme.card }]}>
              <View style={styles.resultContent}>
                <View style={styles.streamHeaderRow}>
                  <TeamBadge url={badgeUrl(selectedFixture?.strHomeTeamBadge)} name={teamA} abbr={teamAbbr(teamA)} size={28} />
                  <Text style={[styles.resultLabel, { color: accent }]}>MAKING THE CALL...</Text>
                  <TeamBadge url={badgeUrl(selectedFixture?.strAwayTeamBadge)} name={teamB} abbr={teamAbbr(teamB)} size={28} />
                </View>
                {live.analysis ? (
                  <Text style={[styles.resultText, { color: theme.text }]}>{live.analysis}</Text>
                ) : (
                  <Text style={[styles.resultText, { color: theme.textTertiary }]}>Analyzing matchup...</Text>
                )}
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
  keyPlayerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  keyPlayerDot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 5 },
  keyPlayerText: { flex: 1, fontSize: 13, lineHeight: 19 },
});
