import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, TextInput, Image,
  KeyboardAvoidingView, Platform, Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { completion, cancel, InferenceCancelledError } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import { getTheme } from '../theme';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../navigation/AppNavigator';
import { IconTarget, IconStop, IconBack } from '../components/Icons';
import { llmManager } from '../utils/modelManager';
import { pickTextCapable } from '../utils/models';
import { syncModelsFromDisk, getGenParams, getDefaultModelId } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';
import { fetchAndCacheFixtures, isWorldCup, isLive, isFinished, fixtureOrder, fmtMatchTime as fmtTime, badgeUrl, todayISO, type Fixture } from '../utils/fixtures';
import { createSession, addMessage, addPrediction } from '../utils/historyDb';
import { settlePendingPredictions, getPredictionRecord } from '../utils/predictionTracker';
import { fetchBothTeamForms, formatFormContext, type TeamForm } from '../utils/teamStats';
import { logInference } from '../utils/auditLogger';

const SYSTEM_PROMPT = `You are Scout's Predictor — a veteran football analyst who ALWAYS calls the match. You never refuse, never hedge, never say you lack information. Pundits get paid to commit — so do you.

When [LIVE FORM DATA] is present, treat it as ground truth for recent form — it comes directly from TheSportsDB and overrides your training assumptions. Weight it heavily alongside tactical identity, squad quality, and head-to-head history.

When no live data is present, commit anyway using historical record, playing style, squad depth, and tournament pedigree. Do NOT fabricate recent results — and do NOT complain about missing data. Express uncertainty ONLY through the CONFIDENCE field, never in the analysis text.

Always respond in EXACTLY this format, no deviation:

WINNER: [team name or Draw]
SCORE: [e.g. 2-1]
CONFIDENCE: [Low/Medium/High]
KEY HOME: [home team's most dangerous player — why he decides this match, one short clause]
KEY AWAY: [away team's most dangerous player — why he decides this match, one short clause]
---
[2-4 sentences of sharp reasoning: the tactical matchup, where the game is won and lost, and the form pattern behind your call. If live form data was provided, reference it directly. Write like a pundit making a call, not a bot citing caveats.]

Do not add anything before WINNER or after the analysis. Always respond in English.`;

export default function PredictorScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [context, setContext] = useState('');
  const [prediction, setPrediction] = useState('');
  const [thought, setThought] = useState('');
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  const [noInternet, setNoInternet] = useState(false);
  const [parsed, setParsed] = useState<{ winner: string; score: string; confidence: string; keyHome: string; keyAway: string; analysis: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [noModel, setNoModel] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [thinkingOn, setThinkingOn] = useState(false);
  const [formA, setFormA] = useState<TeamForm | null>(null);
  const [formB, setFormB] = useState<TeamForm | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [record, setRecord] = useState<{ hits: number; misses: number; pending: number } | null>(null);

  const currentRunRef  = useRef<any>(null);
  const mountedRef     = useRef(true);
  const formDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelNameRef   = useRef<string>('');

  // Predict button pulse while generating
  const pulsAnim = useRef(new Animated.Value(1)).current;
  // Result card reveal: scale from 0.92 + fade
  const resultScale = useRef(new Animated.Value(0.92)).current;
  const resultOpacity = useRef(new Animated.Value(0)).current;
  // Loading pulse for model warm-up
  const loadPulse = useRef(new Animated.Value(0.4)).current;
  const loadLoop = useRef<Animated.CompositeAnimation | null>(null);

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
      loadLoop.current?.stop();
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
        const [fa, fb] = await fetchBothTeamForms(teamA.trim(), teamB.trim());
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


  useEffect(() => {
    if (modelLoading && !noModel) {
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(loadPulse, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(loadPulse, { toValue: 0.3, duration: 750, useNativeDriver: true }),
      ]));
      loadLoop.current = loop;
      loop.start();
    } else {
      loadLoop.current?.stop();
      Animated.timing(loadPulse, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [modelLoading, noModel]);

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
      const playing = (f: Fixture) => isLive(f);
      const upcoming = (f: Fixture) => !isLive(f) && !isFinished(f);
      const rail = [
        ...wc.filter(playing),
        ...wc.filter(upcoming),
        ...others.filter(playing),
        ...others.filter(upcoming),
      ].slice(0, 10);
      setFixtures(rail);
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

  const loadModel = async () => {
    try {
      const synced = await syncModelsFromDisk();
      const model = pickTextCapable(synced, await getDefaultModelId(), llmManager.getLoadedModelId());
      if (!model) {
        if (mountedRef.current) { setNoModel(true); setModelLoading(false); }
        return;
      }
      // projectionModelSrc keeps a multimodal model (Gemma) consistent with
      // Scout Lens — the single resident model must be loaded with its mmproj
      const mid = await llmManager.ensure(model, { ctx_size: 2048, device: 'auto', projectionModelSrc: model.projectionModelSrc });
      modelNameRef.current = model.name;
      if (mountedRef.current) { setModelId(mid); setModelLoading(false); }
    } catch {
      if (mountedRef.current) { setNoModel(true); setModelLoading(false); }
    }
  };

  // Lenient parser — small models drift on casing/markdown ("**Winner:**"),
  // so match case-insensitively and strip decoration
  const parsePrediction = (text: string) => {
    const clean = (s: string) => s.replace(/\*+/g, '').trim();
    const lines = text.split('\n').map(l => clean(l));
    const field = (name: string) => {
      const re = new RegExp(`^${name}\\s*:\\s*(.+)$`, 'i');
      for (const l of lines) { const m = l.match(re); if (m) return clean(m[1]); }
      return '';
    };
    const winner = field('WINNER');
    const score = field('SCORE');
    const confidence = field('CONFIDENCE');
    const keyHome = field('KEY\\s*HOME(?:\\s*PLAYER)?');
    const keyAway = field('KEY\\s*AWAY(?:\\s*PLAYER)?');
    const sepIdx = lines.findIndex(l => /^-{3,}$/.test(l));
    const structured = /^(winner|score|confidence|key\s*home|key\s*away)\s*:/i;
    const analysis = sepIdx >= 0
      ? lines.slice(sepIdx + 1).join('\n').trim()
      : lines.filter(l => l && !structured.test(l)).join('\n').trim();
    return { winner, score, confidence, keyHome, keyAway, analysis };
  };

  const predict = async () => {
    if (!teamA.trim() || !teamB.trim() || isGenerating || !modelId) return;
    setPrediction('');
    setThought('');
    setParsed(null);
    setElapsed(null);
    setIsGenerating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const formBlock = (formA || formB)
      ? formatFormContext(teamA.trim(), formA, teamB.trim(), formB) + '\n\n'
      : '';
    const userContext = context.trim() ? `\n\nAdditional context: ${context.trim()}` : '';
    const prompt = `${formBlock}Predict: ${teamA.trim()} vs ${teamB.trim()}${userContext}`;
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
        captureThinking: thinkingOn,
        generationParams: {
          predict: 380,
          temp: gp.temp,
          top_k: gp.top_k,
          top_p: gp.top_p,
          repeat_penalty: gp.repeat_penalty,
          reasoning_budget: thinkingOn ? -1 as -1 : 0 as 0,
        },
      });
      currentRunRef.current = run;
      registerInferenceCancel(() => {
        if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
      });
      showRunningNotification('Predictor');

      let streamed = '';
      let thoughtAcc = '';
      let lastFlush = 0;
      for await (const event of run.events) {
        if (event.type === 'thinkingDelta') {
          thoughtAcc += event.text;
          const now = Date.now();
          if (mountedRef.current && now - lastFlush > 100) {
            lastFlush = now;
            setThought(thoughtAcc);
          }
        } else if (event.type === 'contentDelta') {
          streamed += event.text;
          const now = Date.now();
          if (mountedRef.current && now - lastFlush > 100) {
            lastFlush = now;
            setPrediction(streamed);
          }
        }
      }
      if (mountedRef.current) setPrediction(streamed);
      const [, stats] = await Promise.all([run.final, run.stats]);
      currentRunRef.current = null;
      clearNotification();

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
        setElapsed(Math.round((Date.now() - genStart) / 100) / 10);
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
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      currentRunRef.current = null;
      clearNotification();
      if (mountedRef.current) {
        if (!(err instanceof InferenceCancelledError)) setPrediction('Prediction failed. Try again.');
        setIsGenerating(false);
      }
    }
  };

  const stopPrediction = () => {
    if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
  };

  const accent = theme.accent;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: theme.border }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backBtn}
          >
            <IconBack size={22} color={theme.text} />
          </TouchableOpacity>
          <View style={[styles.headerIcon, { backgroundColor: accent + '22' }]}>
            <IconTarget size={14} color={accent} />
          </View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Predictor</Text>
          {record && record.hits + record.misses > 0 && (
            <View style={[styles.recordChip, { backgroundColor: accent + '16', borderColor: accent + '40' }]}>
              <Text style={[styles.recordChipText, { color: accent }]}>
                {record.hits}W · {record.misses}L
              </Text>
            </View>
          )}
          {modelId && <View style={[styles.liveDot, { backgroundColor: accent }]} />}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => setThinkingOn(v => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={[styles.thinkBtn, { backgroundColor: thinkingOn ? accent + '28' : 'transparent', borderColor: thinkingOn ? accent : theme.border }]}
          >
            <Text style={[styles.thinkBtnText, { color: thinkingOn ? accent : theme.textSecondary }]}>
              {thinkingOn ? 'Deep ON' : 'Deep'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('History', { tab: 'predictor' })}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[styles.historyBtn, { color: theme.textSecondary }]}>History</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Today's fixtures — World Cup first */}
        <View style={styles.fixturesSection}>
          <View style={styles.fixturesHeader}>
            <View>
              <Text style={[styles.fixturesSectionLabel, { color: accent }]}>
                {fixtures.some(f => isWorldCup(f) && isLive(f)) ? 'WORLD CUP · LIVE' : fixtures.some(isWorldCup) ? 'WORLD CUP & MATCHDAY' : fixtures.some(isLive) ? 'MATCHDAY · LIVE' : 'MATCHDAY'}
              </Text>
              <Text style={[styles.fixturesTodayLabel, { color: theme.textSecondary }]}>
                World Cup first · live scores · upcoming
              </Text>
            </View>
            <View style={[styles.apiDisclosure, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.apiDisclosureText, { color: theme.textSecondary }]}>TheSportsDB</Text>
            </View>
          </View>

          {fixturesLoading ? (
            <Text style={[styles.fixturesLoading, { color: theme.textSecondary }]}>Loading fixtures...</Text>
          ) : noInternet ? (
            <TouchableOpacity
              style={[styles.noInternetCard, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={retryFixtures}
              activeOpacity={0.8}
            >
              <View style={[styles.noInternetDot, { backgroundColor: theme.border }]} />
              <View style={styles.noInternetText}>
                <Text style={[styles.noInternetTitle, { color: theme.text }]}>Turn on internet to load fixtures</Text>
                <Text style={[styles.noInternetSub, { color: theme.textSecondary }]}>
                  Tap to retry · AI prediction runs offline
                </Text>
              </View>
            </TouchableOpacity>
          ) : fixtures.length === 0 ? (
            <Text style={[styles.fixturesLoading, { color: theme.textSecondary }]}>
              No matches today · Type any teams below to predict
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fixturesScroll}>
              {fixtures.map(f => {
                const isWC = /world cup/i.test(f.strLeague) || /fifa wc/i.test(f.strLeague);
                const selected = teamA === f.strHomeTeam && teamB === f.strAwayTeam;
                return (
                  <TouchableOpacity
                    key={f.idEvent}
                    style={[styles.fixtureCard, {
                      backgroundColor: theme.card,
                      borderColor: selected ? accent : isWC ? accent + '50' : theme.border,
                    }]}
                    onPress={() => {
                      setTeamA(f.strHomeTeam);
                      setTeamB(f.strAwayTeam);
                      setParsed(null);
                      setPrediction('');
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    activeOpacity={0.75}
                  >
                    {isWC && (
                      <View style={[styles.wcBadge, { backgroundColor: accent + '20' }]}>
                        <Text style={[styles.wcBadgeText, { color: accent }]}>WC 2026</Text>
                      </View>
                    )}
                    <Text style={[styles.fixtureLeague, { color: theme.textSecondary }]} numberOfLines={1}>
                      {f.strLeague}
                    </Text>
                    <View style={styles.fixtureTeamRow}>
                      {badgeUrl(f.strHomeTeamBadge) ? (
                        <Image source={{ uri: badgeUrl(f.strHomeTeamBadge)! }} style={styles.fixtureBadge} resizeMode="contain" />
                      ) : (
                        <View style={[styles.fixtureBadgeFallback, { backgroundColor: theme.cardAlt }]} />
                      )}
                      <Text style={[styles.fixtureHome, { color: theme.text }]} numberOfLines={1}>{f.strHomeTeam}</Text>
                    </View>
                    {f.intHomeScore != null && f.intAwayScore != null ? (
                      <View style={styles.fixtureScoreRow}>
                        {isLive(f) && <View style={styles.fixtureLiveDot} />}
                        <Text style={[styles.fixtureScore, { color: isLive(f) ? '#ef4444' : theme.text }]}>
                          {f.intHomeScore}-{f.intAwayScore}
                        </Text>
                        <Text style={[styles.fixtureStatus, { color: isLive(f) ? '#ef4444' : theme.textSecondary }]}>
                          {isLive(f) ? 'LIVE' : 'FT'}
                        </Text>
                      </View>
                    ) : (
                      <Text style={[styles.fixtureVs, { color: theme.textSecondary }]}>vs</Text>
                    )}
                    <View style={styles.fixtureTeamRow}>
                      {badgeUrl(f.strAwayTeamBadge) ? (
                        <Image source={{ uri: badgeUrl(f.strAwayTeamBadge)! }} style={styles.fixtureBadge} resizeMode="contain" />
                      ) : (
                        <View style={[styles.fixtureBadgeFallback, { backgroundColor: theme.cardAlt }]} />
                      )}
                      <Text style={[styles.fixtureAway, { color: theme.text }]} numberOfLines={1}>{f.strAwayTeam}</Text>
                    </View>
                    {!isLive(f) && !isFinished(f) && fmtTime(f.strTime) ? (
                      <Text style={[styles.fixtureTime, { color: accent }]}>
                        {f.dateEvent && f.dateEvent !== todayISO()
                          ? `${new Date(f.dateEvent).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${fmtTime(f.strTime)}`
                          : fmtTime(f.strTime)}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Model loading pulse */}
        {modelLoading && !noModel && (
          <Animated.View style={[styles.loadingBar, { backgroundColor: theme.card, borderColor: theme.border, opacity: loadPulse }]}>
            <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Warming up model...</Text>
          </Animated.View>
        )}

        {/* Team inputs */}
        <View style={styles.matchup}>
          <View style={[styles.teamCard, { backgroundColor: theme.card, borderColor: teamA.trim() ? accent : theme.border }]}>
            <Text style={[styles.teamCardLabel, { color: theme.textSecondary }]}>Home</Text>
            <TextInput
              style={[styles.teamInput, { color: theme.text }]}
              placeholder="e.g. Arsenal"
              placeholderTextColor={theme.textSecondary}
              value={teamA}
              onChangeText={t => { setTeamA(t); setParsed(null); }}
              returnKeyType="next"
            />
          </View>

          <View style={[styles.vsBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.vsText, { color: theme.textSecondary }]}>VS</Text>
          </View>

          <View style={[styles.teamCard, { backgroundColor: theme.card, borderColor: teamB.trim() ? accent : theme.border }]}>
            <Text style={[styles.teamCardLabel, { color: theme.textSecondary }]}>Away</Text>
            <TextInput
              style={[styles.teamInput, { color: theme.text }]}
              placeholder="e.g. Real Madrid"
              placeholderTextColor={theme.textSecondary}
              value={teamB}
              onChangeText={t => { setTeamB(t); setParsed(null); }}
              returnKeyType="done"
            />
          </View>
        </View>

        {/* Live form section — appears when both teams searched */}
        {(formLoading || formA || formB) && (
          <View style={[styles.formSection, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.formHeader}>
              <View style={[styles.formDot, { backgroundColor: formLoading ? theme.textSecondary : '#22c55e' }]} />
              <Text style={[styles.formLabel, { color: formLoading ? theme.textSecondary : '#22c55e' }]}>
                {formLoading ? 'Fetching live form...' : 'Live form · TheSportsDB'}
              </Text>
            </View>
            {!formLoading && (
              <View style={styles.formRows}>
                {[{ name: teamA, form: formA }, { name: teamB, form: formB }].map(({ name, form }) => (
                  <View key={name} style={styles.formRow}>
                    <Text style={[styles.formTeamName, { color: theme.textSecondary }]} numberOfLines={1}>
                      {name.slice(0, 12).toUpperCase()}
                    </Text>
                    <View style={styles.formDots}>
                      {form ? form.form.map((r, i) => (
                        <View key={i} style={[
                          styles.formDotCircle,
                          { backgroundColor: r === 'W' ? '#22c55e' : r === 'D' ? '#f59e0b' : '#ef4444' },
                        ]}>
                          <Text style={styles.formDotText}>{r}</Text>
                        </View>
                      )) : (
                        <Text style={[styles.formNotFound, { color: theme.textSecondary }]}>not found</Text>
                      )}
                    </View>
                    {form && form.events[0] ? (
                      <Text style={[styles.formLastResult, { color: theme.textSecondary }]} numberOfLines={1}>
                        {form.events[0].score} vs {form.events[0].opponent}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Optional context */}
        <TextInput
          style={[styles.contextInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
          placeholder="Add context: injuries, venue, pressure, head-to-head..."
          placeholderTextColor={theme.textSecondary}
          value={context}
          onChangeText={setContext}
          multiline
          numberOfLines={2}
        />

        {/* Predict / Stop button */}
        <Animated.View style={{ opacity: pulsAnim }}>
          <TouchableOpacity
            style={[styles.predictBtn, {
              backgroundColor: isGenerating ? theme.error : accent,
              opacity: (teamA.trim() && teamB.trim() && modelId) || isGenerating ? 1 : 0.38,
            }]}
            onPress={isGenerating ? stopPrediction : predict}
            disabled={!isGenerating && (!teamA.trim() || !teamB.trim() || !modelId)}
            activeOpacity={0.82}
          >
            {isGenerating ? (
              <View style={styles.btnInner}>
                <IconStop size={18} color="#fff" />
                <Text style={[styles.predictBtnText, { color: '#fff' }]}>Stop</Text>
              </View>
            ) : (
              <View style={styles.btnInner}>
                <IconTarget size={18} color={theme.accentFg} />
                <Text style={[styles.predictBtnText, { color: theme.accentFg }]}>Predict Match</Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {noModel && (
          <View style={[styles.noModelCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.noModelText, { color: theme.textSecondary }]}>
              No model downloaded. Go to Models to download one.
            </Text>
          </View>
        )}

        {/* Disclosure */}
        <View style={styles.disclosureRow}>
          <Text style={[styles.disclosureText, { color: theme.textSecondary }]}>
            Fixtures: TheSportsDB (thesportsdb.com) · Prediction AI: QVAC SDK, on-device
          </Text>
        </View>

        {/* Immediate feedback — visible from the instant Predict is pressed
            until the first token arrives, so the wait never looks frozen */}
        {isGenerating && thought.length === 0 && prediction.length === 0 && (
          <Animated.View style={[styles.resultCard, { backgroundColor: theme.card, borderColor: theme.border, opacity: pulsAnim }]}>
            <View style={styles.resultContent}>
              <Text style={[styles.resultLabel, { color: accent }]}>
                {thinkingOn ? 'DEEP ANALYSIS STARTING...' : 'ANALYZING THE MATCHUP...'}
              </Text>
              <Text style={[styles.resultText, { color: theme.textSecondary }]}>
                {formA || formB
                  ? 'Weighing live form, tactical matchup, and squad quality.'
                  : 'Weighing tactical matchup, squad quality, and history.'}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Deep-mode thinking stream */}
        {isGenerating && thinkingOn && thought.length > 0 && prediction.length === 0 && (
          <View style={[styles.resultCard, { backgroundColor: '#1a1200', borderColor: '#f59e0b33' }]}>
            <View style={styles.resultContent}>
              <Text style={[styles.resultLabel, { color: '#f59e0b' }]}>READING THE GAME...</Text>
              <Text style={styles.thoughtText} numberOfLines={8}>{thought}</Text>
            </View>
          </View>
        )}

        {/* Streaming result — parsed live so raw WINNER:/SCORE: lines never
            show; fields pop in as chips, analysis streams below */}
        {isGenerating && prediction.length > 0 && (() => {
          const live = parsePrediction(prediction);
          return (
            <View style={[styles.resultCard, { backgroundColor: theme.card, borderColor: accent + '50' }]}>
              <View style={styles.resultContent}>
                <Text style={[styles.resultLabel, { color: accent }]}>MAKING THE CALL...</Text>
                {(live.winner || live.score || live.confidence) && (
                  <View style={styles.liveChipsRow}>
                    {live.winner ? (
                      <View style={[styles.liveFieldChip, { backgroundColor: accent + '18', borderColor: accent + '40' }]}>
                        <Text style={[styles.liveFieldChipText, { color: accent }]}>{live.winner}</Text>
                      </View>
                    ) : null}
                    {live.score ? (
                      <View style={[styles.liveFieldChip, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
                        <Text style={[styles.liveFieldChipText, { color: theme.text }]}>{live.score}</Text>
                      </View>
                    ) : null}
                    {live.confidence ? (
                      <View style={[styles.liveFieldChip, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
                        <Text style={[styles.liveFieldChipText, { color: theme.textSecondary }]}>{live.confidence}</Text>
                      </View>
                    ) : null}
                  </View>
                )}
                {live.analysis ? (
                  <Text style={[styles.resultText, { color: theme.text }]}>{live.analysis}</Text>
                ) : null}
              </View>
            </View>
          );
        })()}

        {/* Final result — spring reveal with scoreboard */}
        {!isGenerating && parsed && (
          <Animated.View style={{ opacity: resultOpacity, transform: [{ scale: resultScale }] }}>
            {/* Scoreboard */}
            <View style={[styles.scoreboard, { backgroundColor: theme.card, borderColor: accent + '40' }]}>
              <View style={[styles.scoreboardTop, { borderBottomColor: theme.border }]}>
                <Text style={[styles.scoreboardLabel, { color: accent }]}>PREDICTION</Text>
                {parsed.confidence ? (
                  <View style={[styles.confBadge, {
                    backgroundColor: parsed.confidence === 'High' ? accent + '22' : theme.cardAlt,
                    borderColor: parsed.confidence === 'High' ? accent + '55' : theme.border,
                  }]}>
                    <Text style={[styles.confText, { color: parsed.confidence === 'High' ? accent : theme.textSecondary }]}>
                      {parsed.confidence} confidence
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.scoreRow}>
                <View style={styles.scoreTeam}>
                  <Text style={[styles.scoreTeamName, { color: theme.text }]} numberOfLines={2}>{teamA}</Text>
                  {parsed.winner === teamA && (
                    <View style={[styles.winnerTag, { backgroundColor: accent }]}>
                      <Text style={styles.winnerTagText}>WIN</Text>
                    </View>
                  )}
                </View>
                <View style={styles.scoreCenter}>
                  {parsed.score ? (
                    <Text style={[styles.scoreText, { color: theme.text }]}>{parsed.score}</Text>
                  ) : (
                    <Text style={[styles.scoreVs, { color: theme.textSecondary }]}>vs</Text>
                  )}
                </View>
                <View style={[styles.scoreTeam, styles.scoreTeamRight]}>
                  <Text style={[styles.scoreTeamName, { color: theme.text }]} numberOfLines={2}>{teamB}</Text>
                  {parsed.winner === teamB && (
                    <View style={[styles.winnerTag, { backgroundColor: accent }]}>
                      <Text style={styles.winnerTagText}>WIN</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {/* Players to watch */}
            {(parsed.keyHome || parsed.keyAway) && (
              <View style={[styles.keyPlayersCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.resultLabel, { color: accent }]}>PLAYERS TO WATCH</Text>
                {parsed.keyHome ? (
                  <View style={styles.keyPlayerRow}>
                    <View style={[styles.keyPlayerDot, { backgroundColor: '#ef4444' }]} />
                    <Text style={[styles.keyPlayerText, { color: theme.text }]}>{parsed.keyHome}</Text>
                  </View>
                ) : null}
                {parsed.keyAway ? (
                  <View style={styles.keyPlayerRow}>
                    <View style={[styles.keyPlayerDot, { backgroundColor: '#3b82f6' }]} />
                    <Text style={[styles.keyPlayerText, { color: theme.text }]}>{parsed.keyAway}</Text>
                  </View>
                ) : null}
              </View>
            )}

            {/* Analysis */}
            {parsed.analysis ? (
              <View style={[styles.analysisCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={styles.resultContent}>
                  <View style={styles.analysisHeader}>
                    <Text style={[styles.resultLabel, { color: accent }]}>ANALYSIS</Text>
                    <View style={styles.analysisActions}>
                      <TouchableOpacity
                        onPress={() => {
                          const full = `${teamA} vs ${teamB}\n${parsed.winner ? `Winner: ${parsed.winner}` : ''} ${parsed.score}\n\n${parsed.analysis}`;
                          Clipboard.setStringAsync(full.trim()).catch(() => {});
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={[styles.copyBtn, { color: theme.textSecondary }]}>Copy</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          const msg = `Scout calls it: ${parsed.winner} ${parsed.score ? `(${parsed.score})` : ''} — ${teamA} vs ${teamB}\n${parsed.confidence} confidence\n\n${parsed.analysis}\n\nPredicted 100% on-device by Scout`;
                          Share.share({ message: msg }).catch(() => {});
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={[styles.copyBtn, { color: accent }]}>Share</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <Text selectable style={[styles.resultText, { color: theme.text }]}>{parsed.analysis}</Text>
                  {elapsed && (
                    <Text style={[styles.stat, { color: theme.textSecondary }]}>{elapsed}s · on-device</Text>
                  )}
                </View>
              </View>
            ) : null}
          </Animated.View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { padding: 2, marginLeft: -6 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  recordChip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  recordChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  thinkBtn: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  thinkBtnText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  historyBtn: { fontSize: 12, fontWeight: '600' },
  content: { padding: 16, gap: 16 },
  loadingBar: {
    borderRadius: 10, borderWidth: 1, padding: 12, alignItems: 'center',
  },
  loadingText: { fontSize: 13, fontWeight: '500' },
  matchup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Fixtures
  fixturesSection: { gap: 10 },
  fixturesHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  fixturesSectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  fixturesTodayLabel: { fontSize: 10, fontWeight: '500', marginTop: 1 },
  apiDisclosure: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  apiDisclosureText: { fontSize: 9, fontWeight: '600' },
  fixturesLoading: { fontSize: 13, fontStyle: 'italic' },
  fixturesScroll: { gap: 8, paddingBottom: 2 },
  fixtureCard: { width: 152, borderRadius: 12, borderWidth: 1, padding: 12, gap: 3 },
  wcBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 2 },
  wcBadgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  fixtureLeague: { fontSize: 9, fontWeight: '600', letterSpacing: 0.3 },
  fixtureTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fixtureBadge: { width: 20, height: 20 },
  fixtureBadgeFallback: { width: 20, height: 20, borderRadius: 10 },
  fixtureHome: { fontSize: 13, fontWeight: '700', flex: 1 },
  fixtureVs: { fontSize: 10, marginLeft: 26 },
  fixtureScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 26 },
  fixtureLiveDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#ef4444' },
  fixtureScore: { fontSize: 14, fontWeight: '900', letterSpacing: 0.3 },
  fixtureStatus: { fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  fixtureAway: { fontSize: 13, fontWeight: '700', flex: 1 },
  fixtureTime: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  noInternetCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, borderWidth: 1, padding: 14,
  },
  noInternetDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  noInternetText: { flex: 1, gap: 2 },
  noInternetTitle: { fontSize: 14, fontWeight: '700' },
  noInternetSub: { fontSize: 11 },

  // Disclosure
  disclosureRow: { paddingVertical: 4 },
  disclosureText: { fontSize: 10, lineHeight: 15, textAlign: 'center' },

  teamCard: {
    flex: 1, borderRadius: 14, borderWidth: 1.5, padding: 14,
    gap: 4, minHeight: 80,
  },
  teamCardLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  teamInput: { fontSize: 15, fontWeight: '700', paddingTop: 2 },
  contextInput: {
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, lineHeight: 20, minHeight: 60,
  },
  // Live form section
  formSection: {
    borderRadius: 14, borderWidth: 1, padding: 14, gap: 10,
  },
  formHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  formDot: { width: 6, height: 6, borderRadius: 3 },
  formLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  formRows: { gap: 8 },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  formTeamName: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, width: 78 },
  formDots: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  formDotCircle: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  formDotText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  formNotFound: { fontSize: 11, fontStyle: 'italic' },
  formLastResult: { flex: 1, fontSize: 11, textAlign: 'right' },
  vsBox: {
    width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  vsText: { fontSize: 11, fontWeight: '800' },
  predictBtn: {
    borderRadius: 14, paddingVertical: 17, alignItems: 'center', justifyContent: 'center',
  },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  predictBtnText: { fontSize: 16, fontWeight: '800' },
  noModelCard: { borderRadius: 10, borderWidth: 1, padding: 14 },
  noModelText: { fontSize: 13, textAlign: 'center' },
  resultCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  resultContent: { flex: 1, padding: 16, gap: 8 },
  resultLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  resultText: { fontSize: 15, lineHeight: 24 },
  thoughtText: { fontSize: 12, lineHeight: 18, color: '#a8a29e', fontStyle: 'italic' },
  stat: { fontSize: 10 },
  analysisHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  analysisActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  copyBtn: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  // Scoreboard
  scoreboard: { borderRadius: 16, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  scoreboardTop: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1,
  },
  scoreboardLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  confBadge: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  confText: { fontSize: 10, fontWeight: '700' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 8 },
  scoreTeam: { flex: 1, alignItems: 'flex-start', gap: 6 },
  scoreTeamRight: { alignItems: 'flex-end' },
  scoreTeamName: { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  winnerTag: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  winnerTagText: { fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  scoreCenter: { alignItems: 'center', minWidth: 60 },
  scoreText: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  scoreVs: { fontSize: 14, fontWeight: '700' },
  analysisCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  keyPlayersCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 9, marginBottom: 10 },
  liveChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  liveFieldChip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  liveFieldChipText: { fontSize: 12, fontWeight: '700' },
  keyPlayerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  keyPlayerDot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 5 },
  keyPlayerText: { flex: 1, fontSize: 13, lineHeight: 19 },
});
