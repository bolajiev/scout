import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Keyboard, Animated, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { completion, cancel, InferenceCancelledError, type Tool } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconSend, IconStop, IconBall, IconBack } from '../components/Icons';
import { llmManager } from '../utils/modelManager';
import { syncModelsFromDisk, getGenParams, getSettings } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';
import { createSession, addMessage } from '../utils/historyDb';
import { formatFixtureContext, fetchTeamForm } from '../utils/teamStats';
import { fetchAndCacheFixtures } from '../utils/fixtures';
import { logInference } from '../utils/auditLogger';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = (SCREEN_W - 48) / 2;

const SYSTEM_PROMPT = `You are Scout's AI Coach — a world-class football analyst running fully on-device. You know tactics, player profiles, club history, tournament formats, and coaching philosophy.

You have tools to fetch live football data from TheSportsDB. Use get_today_fixtures when the user asks about today's matches, games, fixtures, or live scores. Use get_team_form when asked about a specific team's recent results or form.

For tactical, historical, or general football questions, rely on your training knowledge. Always respond in English.`;

const SCOUT_TOOLS: Tool[] = [
  {
    type: 'function',
    name: 'get_today_fixtures',
    description: "Get today's football matches and scores from TheSportsDB. Use when the user asks about today's games, fixtures, live scores, or who is playing.",
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'get_team_form',
    description: "Get a football team's recent match results from TheSportsDB. Use when asked about a specific team's recent form, results, or performance.",
    parameters: {
      type: 'object',
      properties: {
        team_name: { type: 'string', description: 'Name of the football team' },
      },
      required: ['team_name'],
    },
  },
];

const ALL_SUGGESTIONS = [
  'How does a high press work?',
  'Best striker in Champions League history?',
  'Explain the offside rule simply.',
  'What is a false nine?',
  'How does VAR work?',
  'Compare 4-3-3 vs 4-2-3-1 formations.',
  'Who invented total football?',
  'What makes a good defensive midfielder?',
  'Explain gegenpressing tactics.',
  'Best World Cup goals of all time?',
  'How does penalty shootout psychology work?',
  'What is an overlap run in football?',
  'Difference between a box-to-box and a holding midfielder?',
  'How do clubs scout young players?',
  'What makes Mbappe so fast?',
];

const CATEGORIES = [
  { tag: 'TACTICS',   question: 'How does a high press work in modern football?' },
  { tag: 'PLAYERS',   question: 'What makes Mbappe the fastest player right now?' },
  { tag: 'WC 2026',   question: 'Who are the top favorites for FIFA World Cup 2026?' },
  { tag: 'RULES',     question: 'Explain the offside rule with a simple example.' },
];

const rotateSuggestions = (offset: number): string[] =>
  [0, 1, 2].map(i => ALL_SUGGESTIONS[(offset + i) % ALL_SUGGESTIONS.length]);

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

interface Entry {
  id: string;
  question: string;
  answer: string;
  thinking?: string;
  elapsed?: number;
  toks?: number;
  usedLiveData?: boolean;
}

interface StreamSlot {
  id: string;
  question: string;
  answer: string;
  thought: string;
  isThinking: boolean;
  toolStatus: string | null;  // non-null while a tool call is executing
  usedLiveData: boolean;
}

export default function MatchAIScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();
  const accent = theme.accent;

  const [entries, setEntries]           = useState<Entry[]>([]);
  const [slot, setSlot]                 = useState<StreamSlot | null>(null);
  const [input, setInput]               = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelId, setModelId]           = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [noModel, setNoModel]           = useState(false);
  const [thinkingOn, setThinkingOn]     = useState(false);
  const [thoughtOpen, setThoughtOpen]   = useState<Record<string, boolean>>({});
  const [suggOffset, setSuggOffset]     = useState(0);

  const scrollRef        = useRef<ScrollView>(null);
  const currentRunRef    = useRef<any>(null);
  const mountedRef       = useRef(true);
  const prefillFiredRef  = useRef(false);
  const prefillRef       = useRef<string | null>(null);
  const sessionIdRef     = useRef<string | null>(null);
  const loadPulse        = useRef(new Animated.Value(0.4)).current;
  const loadLoopRef      = useRef<Animated.CompositeAnimation | null>(null);
  const entryAnimsRef    = useRef<Record<string, { ty: Animated.Value; op: Animated.Value }>>({});
  const slotRef          = useRef<typeof slot>(null);
  const modelNameRef     = useRef<string>('');

  useEffect(() => { slotRef.current = slot; }, [slot]);

  useEffect(() => {
    mountedRef.current = true;
    loadModel();
    // Sync Deep Reasoning default from global settings
    getSettings().then(s => {
      if (mountedRef.current) setThinkingOn(s.deepReasoning ?? false);
    }).catch(() => {});
    return () => {
      mountedRef.current = false;
      clearNotification();
      loadLoopRef.current?.stop();
      if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (modelLoading && !noModel) {
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(loadPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(loadPulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
      ]));
      loadLoopRef.current = loop;
      loop.start();
    } else {
      loadLoopRef.current?.stop();
      Animated.timing(loadPulse, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }
  }, [modelLoading, noModel]);

  const loadModel = async () => {
    try {
      const synced = await syncModelsFromDisk();
      const model = synced.find((m: any) => m.modelType === 'text');
      if (!model) {
        if (mountedRef.current) { setNoModel(true); setModelLoading(false); }
        return;
      }
      const mid = await llmManager.ensure(model, { ctx_size: 4096, device: 'auto', tools: true, projectionModelSrc: model.projectionModelSrc });
      modelNameRef.current = model.name;
      if (mountedRef.current) {
        setModelId(mid);
        setModelLoading(false);
        const prefill = route.params?.prefill;
        if (prefill && !prefillFiredRef.current) {
          prefillFiredRef.current = true;
          prefillRef.current = prefill; // fired via useEffect once modelId is set
        }
      }
    } catch {
      if (mountedRef.current) { setNoModel(true); setModelLoading(false); }
    }
  };

  const springEntry = (id: string) => {
    const anim = entryAnimsRef.current[id];
    if (!anim) return;
    Animated.parallel([
      Animated.spring(anim.ty, { toValue: 0, friction: 9, tension: 90, useNativeDriver: true }),
      Animated.timing(anim.op, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  const send = useCallback(async (question?: string) => {
    const q = (question ?? input).trim();
    if (!q || isGenerating || !modelId) return;
    setInput('');
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const entryId = `e-${Date.now()}`;
    entryAnimsRef.current[entryId] = { ty: new Animated.Value(24), op: new Animated.Value(0) };

    try {
      if (!sessionIdRef.current) sessionIdRef.current = createSession('matchai', q);
      addMessage(sessionIdRef.current, 'user', q);
    } catch {}

    const history: { role: 'user' | 'assistant' | 'tool'; content: string }[] = entries.map(e => [
      { role: 'user' as const, content: e.question },
      { role: 'assistant' as const, content: e.answer },
    ]).flat();
    history.push({ role: 'user', content: q });

    setSlot({ id: entryId, question: q, answer: '', thought: '', isThinking: thinkingOn, toolStatus: null, usedLiveData: false });
    setIsGenerating(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

    let usedLiveData = false;
    let answerAcc = '';
    let thoughtAcc = '';
    let lastFlush = 0;

    try {
      const gp = await getGenParams();
      const genParams = {
        predict: gp.maxTokens,
        temp: gp.temp,
        top_k: gp.top_k,
        top_p: gp.top_p,
        repeat_penalty: gp.repeat_penalty,
        reasoning_budget: thinkingOn ? -1 as -1 : 0 as 0,
      };
      const t0 = Date.now();

      // ── Pass 1: completion with tools available ─────────────────────────
      const run1 = completion({
        modelId,
        history: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        stream: true,
        tools: SCOUT_TOOLS,
        captureThinking: thinkingOn,
        generationParams: genParams,
      });
      currentRunRef.current = run1;
      registerInferenceCancel(() => {
        if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
      });
      showRunningNotification('AI Coach');

      let pass1Answer = '';
      for await (const event of run1.events) {
        if (event.type === 'thinkingDelta') {
          thoughtAcc += event.text;
          const now = Date.now();
          if (mountedRef.current && now - lastFlush > 40) {
            lastFlush = now;
            setSlot(s => s ? { ...s, thought: thoughtAcc, isThinking: true } : s);
            scrollRef.current?.scrollToEnd({ animated: false });
          }
        } else if (event.type === 'contentDelta') {
          pass1Answer += event.text;
          const now = Date.now();
          if (mountedRef.current && now - lastFlush > 40) {
            lastFlush = now;
            setSlot(s => s ? { ...s, answer: pass1Answer, isThinking: false } : s);
            scrollRef.current?.scrollToEnd({ animated: false });
          }
        }
      }

      const toolCalls = await run1.toolCalls;
      let finalStats = await run1.stats;

      if (toolCalls.length > 0 && mountedRef.current) {
        // ── Tool execution ──────────────────────────────────────────────────
        if (mountedRef.current) { setSlot(s => s ? { ...s, toolStatus: 'Fetching live data...', answer: '' } : s); }

        const toolHistory = [...history, { role: 'assistant' as const, content: pass1Answer }];

        for (const tc of toolCalls) {
          let toolResult = 'No data available.';
          try {
            if (tc.name === 'get_today_fixtures') {
              const { fixtures } = await fetchAndCacheFixtures();
              toolResult = formatFixtureContext(fixtures) || 'No fixtures scheduled today.';
              usedLiveData = true;
            } else if (tc.name === 'get_team_form') {
              const teamName = String(tc.arguments.team_name ?? '');
              const form = await fetchTeamForm(teamName);
              if (form && form.events.length > 0) {
                const lines = form.events.map(e =>
                  `${e.date} vs ${e.opponent}: ${e.score} (${e.result})${e.league ? ' — ' + e.league : ''}`
                );
                toolResult = [
                  `[RECENT RESULTS — ${form.teamName} via TheSportsDB]`,
                  `Form (most recent last): ${form.form.join(' ')}`,
                  ...lines,
                  '[END RESULTS]',
                ].join('\n');
              } else {
                // Fall back to today's fixtures involving the team
                const { fixtures } = await fetchAndCacheFixtures();
                const teamFix = fixtures.filter(f =>
                  f.strHomeTeam?.toLowerCase().includes(teamName.toLowerCase()) ||
                  f.strAwayTeam?.toLowerCase().includes(teamName.toLowerCase())
                );
                toolResult = teamFix.length > 0 ? formatFixtureContext(teamFix) : `No recent data found for ${teamName}.`;
              }
              usedLiveData = true;
            }
          } catch { toolResult = 'Unable to fetch live data.'; }
          toolHistory.push({ role: 'tool', content: toolResult });
        }

        if (!mountedRef.current) return;
        setSlot(s => s ? { ...s, toolStatus: null, answer: '', usedLiveData } : s);

        // ── Pass 2: final answer incorporating tool results ─────────────────
        const run2 = completion({
          modelId,
          history: [{ role: 'system', content: SYSTEM_PROMPT }, ...toolHistory],
          stream: true,
          captureThinking: false,
          generationParams: { ...genParams, reasoning_budget: 0 as 0 },
        });
        currentRunRef.current = run2;

        answerAcc = '';
        lastFlush = 0;
        for await (const event of run2.events) {
          if (event.type === 'contentDelta') {
            answerAcc += event.text;
            const now = Date.now();
            if (mountedRef.current && now - lastFlush > 40) {
              lastFlush = now;
              setSlot(s => s ? { ...s, answer: answerAcc } : s);
              scrollRef.current?.scrollToEnd({ animated: false });
            }
          }
        }
        finalStats = await run2.stats;
      } else {
        answerAcc = pass1Answer;
      }

      if (mountedRef.current) {
        setSlot(s => s ? { ...s, answer: answerAcc, thought: thoughtAcc, isThinking: false } : s);
        scrollRef.current?.scrollToEnd({ animated: false });
      }

      currentRunRef.current = null;
      clearNotification();

      const totalMs = Date.now() - t0;
      logInference('matchai', modelNameRef.current, finalStats?.timeToFirstToken ?? 0, totalMs, finalStats?.generatedTokens ?? 0).catch(() => {});

      const elapsed = Math.round(totalMs / 100) / 10;
      if (sessionIdRef.current && answerAcc) addMessage(sessionIdRef.current, 'assistant', answerAcc);

      if (mountedRef.current) {
        const finished: Entry = { id: entryId, question: q, answer: answerAcc, thinking: thoughtAcc || undefined, elapsed, toks: finalStats?.generatedTokens, usedLiveData };
        setSlot(null);
        setEntries(prev => [...prev, finished]);
        setIsGenerating(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => springEntry(entryId), 20);
      }
    } catch (err) {
      currentRunRef.current = null;
      clearNotification();
      if (mountedRef.current) {
        const fallback = err instanceof InferenceCancelledError ? (slotRef.current?.answer || '...') : 'Could not get a response. Try again.';
        const finished: Entry = { id: entryId, question: q, answer: fallback };
        setSlot(null);
        setEntries(prev => [...prev, finished]);
        setIsGenerating(false);
        setTimeout(() => springEntry(entryId), 20);
      }
    }
  }, [input, isGenerating, modelId, entries, thinkingOn]);

  // Fire prefill after send() is memoized with the real modelId
  useEffect(() => {
    if (modelId && prefillRef.current) {
      const q = prefillRef.current;
      prefillRef.current = null;
      setTimeout(() => send(q), 80);
    }
  }, [modelId, send]);

  const renderThoughtBlock = (thought: string, isStreaming: boolean, entryId: string) => {
    if (!thought) return null;
    const isOpen = isStreaming || thoughtOpen[entryId];
    return (
      <TouchableOpacity
        activeOpacity={isStreaming ? 1 : 0.7}
        onPress={() => !isStreaming && setThoughtOpen(p => ({ ...p, [entryId]: !p[entryId] }))}
        style={[styles.thoughtBlock, { backgroundColor: '#1a1200', borderColor: '#f59e0b33' }]}
      >
        <View style={styles.thoughtHeader}>
          <View style={[styles.thoughtDot, { backgroundColor: isStreaming ? '#f59e0b' : '#78716c' }]} />
          <Text style={[styles.thoughtLabel, { color: isStreaming ? '#f59e0b' : '#78716c' }]}>
            {isStreaming ? 'Thinking...' : `Deep thought  ${isOpen ? '∧' : '∨'}`}
          </Text>
        </View>
        {isOpen && (
          <Text style={styles.thoughtText} numberOfLines={isStreaming ? undefined : 6}>
            {thought}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderEntry = (entry: Entry) => {
    const anim = entryAnimsRef.current[entry.id];
    return (
      <Animated.View
        key={entry.id}
        style={[styles.entryBlock, anim ? { opacity: anim.op, transform: [{ translateY: anim.ty }] } : undefined]}
      >
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: accent }]}>
            <Text style={styles.userText}>{entry.question}</Text>
          </View>
        </View>
        {entry.thinking && renderThoughtBlock(entry.thinking, false, entry.id)}
        <View style={styles.aiRow}>
          <View style={styles.aiCol}>
            <View style={[styles.aiBubble, { backgroundColor: theme.cardAlt }]}>
              <Text style={[styles.aiText, { color: theme.text }]}>{entry.answer}</Text>
            </View>
            <View style={styles.statRow}>
              {entry.usedLiveData && (
                <View style={[styles.liveChip, { backgroundColor: '#22c55e14', borderColor: '#22c55e25' }]}>
                  <View style={[styles.liveDotSmall, { backgroundColor: '#22c55e' }]} />
                  <Text style={[styles.liveChipText, { color: '#22c55e' }]}>TheSportsDB</Text>
                </View>
              )}
              {entry.elapsed != null && (
                <Text style={[styles.stat, { color: theme.textSecondary }]}>
                  {entry.elapsed}s{entry.toks ? ` · ${Math.round(entry.toks / (entry.elapsed || 1))} tok/s` : ''} · on-device
                </Text>
              )}
            </View>
          </View>
        </View>
      </Animated.View>
    );
  };

  // ── Empty state ────────────────────────────────────────────────────────────
  const renderEmpty = () => (
    <View style={styles.emptyWrap}>
      {/* Brand mark */}
      <Animated.View style={[styles.brandMark, { backgroundColor: accent + '14', opacity: loadPulse }]}>
        <IconBall size={36} color={accent} />
      </Animated.View>

      <Text style={[styles.greeting, { color: theme.textSecondary }]}>{getGreeting()}</Text>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>Your AI Football Coach</Text>

      {/* Status pills row */}
      <View style={styles.pillRow}>
        <View style={[styles.statusPill, { backgroundColor: accent + '14', borderColor: accent + '30' }]}>
          <View style={[styles.pillDot, { backgroundColor: modelId ? accent : theme.textSecondary }]} />
          <Text style={[styles.pillText, { color: modelId ? accent : theme.textSecondary }]}>
            {modelLoading ? 'Loading...' : noModel ? 'No model' : 'On-device AI'}
          </Text>
        </View>

        <View style={[styles.statusPill, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.pillDot, { backgroundColor: accent }]} />
          <Text style={[styles.pillText, { color: theme.textSecondary }]}>Private · No cloud</Text>
        </View>
      </View>

      {noModel ? (
        <View style={[styles.noModelCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.noModelText, { color: theme.textSecondary }]}>No model downloaded — go to Models.</Text>
        </View>
      ) : (
        <>
          {/* Category cards 2×2 */}
          <View style={styles.cardGrid}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.tag}
                style={[styles.categoryCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => send(cat.question)}
                activeOpacity={0.75}
                disabled={modelLoading || !modelId}
              >
                <Text style={[styles.cardTag, { color: accent }]}>{cat.tag}</Text>
                <Text style={[styles.cardQuestion, { color: theme.text }]} numberOfLines={3}>
                  {cat.question}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Rotating chips */}
          <View style={styles.chipRow}>
            {rotateSuggestions(suggOffset).map(q => (
              <TouchableOpacity
                key={q}
                style={[styles.suggChip, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => send(q)}
                disabled={modelLoading || !modelId}
                activeOpacity={0.72}
              >
                <Text style={[styles.suggText, { color: theme.textSecondary }]}>{q}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => setSuggOffset(o => (o + 3) % ALL_SUGGESTIONS.length)}
              style={[styles.suggChip, { borderColor: accent + '35', backgroundColor: accent + '0c' }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.suggText, { color: accent }]}>More...</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: theme.border }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backBtn}
          >
            <IconBack size={22} color={theme.text} />
          </TouchableOpacity>
          <View>
            <Text style={[styles.headerTitle, { color: theme.text }]}>AI Coach</Text>
            <Text style={[styles.headerSub, { color: modelId && !modelLoading ? accent : theme.textSecondary }]}>
              {modelLoading ? 'Loading model...' : noModel ? 'No model' : 'On-device · Private'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('History', { screen: 'matchai' })}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={[styles.historyBtn, { color: theme.textSecondary }]}>History</Text>
        </TouchableOpacity>
      </View>

      {/* Feed */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 110 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {entries.length === 0 && !slot && renderEmpty()}
        {entries.map(renderEntry)}

        {/* Active streaming slot */}
        {slot && (
          <View style={styles.entryBlock}>
            <View style={styles.userRow}>
              <View style={[styles.userBubble, { backgroundColor: accent }]}>
                <Text style={styles.userText}>{slot.question}</Text>
              </View>
            </View>
            {slot.toolStatus && (
              <View style={[styles.liveChip, { backgroundColor: '#22c55e14', borderColor: '#22c55e25', alignSelf: 'flex-start' }]}>
                <View style={[styles.liveDotSmall, { backgroundColor: '#22c55e' }]} />
                <Text style={[styles.liveChipText, { color: '#22c55e' }]}>{slot.toolStatus}</Text>
              </View>
            )}
            {slot.thought.length > 0 && renderThoughtBlock(slot.thought, slot.isThinking, slot.id)}
            <View style={styles.aiRow}>
              <View style={[styles.aiBubble, { backgroundColor: theme.cardAlt }]}>
                {slot.answer.length > 0 ? (
                  <Text style={[styles.aiText, { color: theme.text }]}>{slot.answer}</Text>
                ) : (
                  <View style={styles.typingRow}>
                    <View style={[styles.typingDot, { backgroundColor: accent }]} />
                    <View style={[styles.typingDot, { backgroundColor: accent, opacity: 0.6 }]} />
                    <View style={[styles.typingDot, { backgroundColor: accent, opacity: 0.3 }]} />
                  </View>
                )}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Input bar */}
      <View style={[styles.inputBar, { backgroundColor: theme.background, borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity
          onPress={() => setThinkingOn(v => !v)}
          style={[styles.deepToggle, { backgroundColor: thinkingOn ? accent + '1a' : theme.card, borderColor: thinkingOn ? accent : theme.border }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.deepToggleText, { color: thinkingOn ? accent : theme.textSecondary }]}>Deep</Text>
          <View style={[styles.deepDot, { backgroundColor: thinkingOn ? accent : theme.border }]} />
        </TouchableOpacity>

        <TextInput
          style={[styles.input, { backgroundColor: theme.cardAlt, color: theme.text }]}
          placeholder={modelLoading ? 'Loading model...' : 'Message AI Coach...'}
          placeholderTextColor={theme.textSecondary}
          value={input}
          onChangeText={setInput}
          multiline
          editable={!isGenerating && !modelLoading && !!modelId}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={() => { if (input.trim()) send(); }}
        />

        {isGenerating ? (
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: '#ef4444' }]}
            onPress={() => { if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {}); }}
          >
            <IconStop size={17} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: accent, opacity: input.trim() && modelId ? 1 : 0.3 }]}
            onPress={() => send()}
            disabled={!input.trim() || !modelId || isGenerating}
          >
            <IconSend size={17} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingBottom: 11, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: { padding: 2, marginRight: 2 },
  headerTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.4 },
  headerSub: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  historyBtn: { fontSize: 13, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 16, gap: 4 },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyWrap: { paddingTop: 40, paddingHorizontal: 2, gap: 14, alignItems: 'center' },
  brandMark: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  greeting: { fontSize: 14, fontWeight: '500', marginTop: -4 },
  emptyTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center', marginTop: -6 },

  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6,
  },
  pillDot: { width: 5, height: 5, borderRadius: 2.5 },
  pillText: { fontSize: 12, fontWeight: '600' },

  noModelCard: { borderRadius: 12, borderWidth: 1, padding: 14, width: '100%', marginTop: 4 },
  noModelText: { fontSize: 13, textAlign: 'center' },

  // Category cards
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, width: '100%', marginTop: 4 },
  categoryCard: {
    width: CARD_W, borderRadius: 16, borderWidth: 1,
    padding: 16, gap: 8, borderLeftWidth: 3,
  },
  cardTag: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  cardQuestion: { fontSize: 14, fontWeight: '500', lineHeight: 20 },

  // Chip row
  chipRow: { width: '100%', gap: 7, marginTop: -2 },
  suggChip: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11 },
  suggText: { fontSize: 13, fontWeight: '500' },

  // ── Message blocks ────────────────────────────────────────────────────────
  entryBlock: { marginBottom: 18, gap: 7 },

  userRow: { alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '78%', borderRadius: 20, borderBottomRightRadius: 6,
    paddingHorizontal: 15, paddingVertical: 10,
  },
  userText: { fontSize: 16, lineHeight: 22, fontWeight: '500', color: '#fff' },

  aiRow: { alignItems: 'flex-start' },
  aiCol: { alignItems: 'flex-start', gap: 5, maxWidth: '90%' },
  aiBubble: {
    borderRadius: 20, borderBottomLeftRadius: 6,
    paddingHorizontal: 15, paddingVertical: 11, gap: 6,
  },
  aiText: { fontSize: 16, lineHeight: 24 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4 },
  stat: { fontSize: 10, fontWeight: '500' },
  liveChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4,
  },
  liveDotSmall: { width: 4, height: 4, borderRadius: 2 },
  liveChipText: { fontSize: 10, fontWeight: '700' },

  typingRow: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 3 },
  typingDot: { width: 7, height: 7, borderRadius: 3.5 },

  // Thought block
  thoughtBlock: {
    borderRadius: 12, borderWidth: 1, padding: 11, marginRight: 30, gap: 6,
  },
  thoughtHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  thoughtDot: { width: 5, height: 5, borderRadius: 2.5 },
  thoughtLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  thoughtText: { fontSize: 12, lineHeight: 18, color: '#a8a29e', fontStyle: 'italic' },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  deepToggle: {
    borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7,
    flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3,
  },
  deepToggleText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  deepDot: { width: 5, height: 5, borderRadius: 2.5 },
  input: {
    flex: 1, borderRadius: 22,
    paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11,
    fontSize: 16, lineHeight: 21, maxHeight: 130,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
});
