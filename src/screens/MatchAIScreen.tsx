import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Keyboard, Animated, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { completion, cancel, InferenceCancelledError } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconSend, IconStop, IconBall } from '../components/Icons';
import { llmManager } from '../utils/modelManager';
import { syncModelsFromDisk, getGenParams } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';
import { createSession, addMessage } from '../utils/historyDb';
import { needsLiveData, formatFixtureContext } from '../utils/teamStats';
import { fetchAndCacheFixtures } from '../utils/fixtures';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = (SCREEN_W - 48) / 2;

const SYSTEM_PROMPT = `You are Scout's AI Coach — a world-class football analyst running fully on-device. You know tactics, player profiles, club history, tournament formats, and coaching philosophy.

When [LIVE FIXTURES] data is present in the message, use it to answer questions about today's matches accurately. For general tactical or historical questions, rely on your training knowledge — do not fabricate live data that isn't provided.

Answer concisely and with authority. Always respond in English.`;

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
  fetchingLive: boolean;   // true while TheSportsDB fetch is in progress
  usedLiveData: boolean;   // true if live fixture context was injected
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
  const sessionIdRef     = useRef<string | null>(null);
  const loadPulse        = useRef(new Animated.Value(0.4)).current;
  const loadLoopRef      = useRef<Animated.CompositeAnimation | null>(null);
  const entryAnimsRef    = useRef<Record<string, { ty: Animated.Value; op: Animated.Value }>>({});

  useEffect(() => {
    mountedRef.current = true;
    loadModel();
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
      const mid = await llmManager.ensure(model, { ctx_size: 4096, device: 'auto' });
      if (mountedRef.current) {
        setModelId(mid);
        setModelLoading(false);
        const prefill = route.params?.prefill;
        if (prefill && !prefillFiredRef.current) {
          prefillFiredRef.current = true;
          setTimeout(() => send(prefill), 100);
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

    if (!sessionIdRef.current) sessionIdRef.current = createSession('matchai', q);
    addMessage(sessionIdRef.current, 'user', q);

    const history = entries.map(e => [
      { role: 'user' as const, content: e.question },
      { role: 'assistant' as const, content: e.answer },
    ]).flat();

    const wantsLive = needsLiveData(q);
    setSlot({ id: entryId, question: q, answer: '', thought: '', isThinking: thinkingOn, fetchingLive: wantsLive, usedLiveData: false });
    setIsGenerating(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

    // Only hit TheSportsDB if the question actually needs live match data
    let liveBlock = '';
    if (wantsLive) {
      try {
        const { fixtures } = await fetchAndCacheFixtures();
        const ctx = formatFixtureContext(fixtures);
        if (ctx) liveBlock = ctx;
      } catch {}
      if (mountedRef.current) {
        setSlot(s => s ? { ...s, fetchingLive: false, usedLiveData: !!liveBlock } : s);
      }
    }

    const userContent = liveBlock ? `${liveBlock}\n\nQuestion: ${q}` : q;
    history.push({ role: 'user', content: userContent });

    try {
      const gp = await getGenParams();
      const t0 = Date.now();
      const run = completion({
        modelId,
        history: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        stream: true,
        captureThinking: thinkingOn,
        generationParams: {
          predict: gp.maxTokens,
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
      showRunningNotification('AI Coach');

      let answerAcc = '';
      let thoughtAcc = '';
      let lastFlush = 0;

      for await (const event of run.events) {
        if (event.type === 'thinkingDelta') {
          thoughtAcc += event.text;
          const now = Date.now();
          if (mountedRef.current && now - lastFlush > 40) {
            lastFlush = now;
            setSlot(s => s ? { ...s, thought: thoughtAcc, isThinking: true } : s);
            scrollRef.current?.scrollToEnd({ animated: false });
          }
        } else if (event.type === 'contentDelta') {
          answerAcc += event.text;
          const now = Date.now();
          if (mountedRef.current && now - lastFlush > 40) {
            lastFlush = now;
            setSlot(s => s ? { ...s, answer: answerAcc, isThinking: false } : s);
            scrollRef.current?.scrollToEnd({ animated: false });
          }
        }
      }

      if (mountedRef.current) {
        setSlot(s => s ? { ...s, answer: answerAcc, thought: thoughtAcc, isThinking: false } : s);
        scrollRef.current?.scrollToEnd({ animated: false });
      }

      const [, stats] = await Promise.all([run.final, run.stats]);
      currentRunRef.current = null;
      clearNotification();

      const elapsed = Math.round((Date.now() - t0) / 100) / 10;
      if (sessionIdRef.current && answerAcc) addMessage(sessionIdRef.current, 'assistant', answerAcc);

      if (mountedRef.current) {
        const usedLive = slot?.usedLiveData ?? false;
        const finished: Entry = { id: entryId, question: q, answer: answerAcc, thinking: thoughtAcc || undefined, elapsed, toks: stats?.generatedTokens, usedLiveData: usedLive };
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
        const fallback = err instanceof InferenceCancelledError ? (slot?.answer || '...') : 'Could not get a response. Try again.';
        const finished: Entry = { id: entryId, question: q, answer: fallback };
        setSlot(null);
        setEntries(prev => [...prev, finished]);
        setIsGenerating(false);
        setTimeout(() => springEntry(entryId), 20);
      }
    }
  }, [input, isGenerating, modelId, entries, thinkingOn]);

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
          <View style={[styles.userBubble, { backgroundColor: accent + '1a', borderColor: accent + '35' }]}>
            <Text style={[styles.userText, { color: theme.text }]}>{entry.question}</Text>
          </View>
        </View>
        {entry.thinking && renderThoughtBlock(entry.thinking, false, entry.id)}
        <View style={styles.aiRow}>
          <View style={styles.aiCol}>
            <View style={[styles.aiBubble, { backgroundColor: theme.card, borderColor: theme.border }]}>
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
      <View style={[styles.header, { paddingTop: insets.top + 14, borderBottomColor: theme.border }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.headerDot, { backgroundColor: accent }]} />
          <Text style={[styles.headerTitle, { color: theme.text }]}>AI Coach</Text>
          {modelId && !modelLoading && <View style={[styles.liveDot, { backgroundColor: accent }]} />}
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
              <View style={[styles.userBubble, { backgroundColor: accent + '1a', borderColor: accent + '35' }]}>
                <Text style={[styles.userText, { color: theme.text }]}>{slot.question}</Text>
              </View>
            </View>
            {slot.fetchingLive && (
              <View style={[styles.liveChip, { backgroundColor: '#22c55e14', borderColor: '#22c55e25', alignSelf: 'flex-start' }]}>
                <View style={[styles.liveDotSmall, { backgroundColor: '#22c55e' }]} />
                <Text style={[styles.liveChipText, { color: '#22c55e' }]}>Fetching live fixtures...</Text>
              </View>
            )}
            {slot.thought.length > 0 && renderThoughtBlock(slot.thought, slot.isThinking, slot.id)}
            <View style={styles.aiRow}>
              <View style={[styles.aiBubble, { backgroundColor: theme.card, borderColor: accent + '45' }]}>
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
          style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
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
            <IconSend size={17} color={theme.accentFg} />
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
    paddingHorizontal: 20, paddingBottom: 13, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  headerDot: { width: 8, height: 8, borderRadius: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  liveDot: { width: 5, height: 5, borderRadius: 2.5 },
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
    maxWidth: '82%', borderRadius: 20, borderBottomRightRadius: 5,
    borderWidth: 1, paddingHorizontal: 15, paddingVertical: 10,
  },
  userText: { fontSize: 15, lineHeight: 22, fontWeight: '500' },

  aiRow: { alignItems: 'flex-start' },
  aiCol: { alignItems: 'flex-start', gap: 5, maxWidth: '90%' },
  aiBubble: {
    borderRadius: 20, borderBottomLeftRadius: 5,
    borderWidth: 1, paddingHorizontal: 15, paddingVertical: 11, gap: 6,
  },
  aiText: { fontSize: 15, lineHeight: 24 },
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
    flex: 1, borderRadius: 22, borderWidth: 1,
    paddingHorizontal: 15, paddingTop: 10, paddingBottom: 10,
    fontSize: 15, lineHeight: 20, maxHeight: 130,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center', marginBottom: 1,
  },
});
