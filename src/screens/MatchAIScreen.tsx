import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { completion, cancel, InferenceCancelledError } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconBack, IconSend, IconStop, IconBall } from '../components/Icons';
import { llmManager } from '../utils/modelManager';
import { syncModelsFromDisk, getGenParams } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';

const SYSTEM_PROMPT = `You are Scout's AI Coach — a world-class football analyst running fully on-device. You know tactics, player profiles, club history, tournament formats, and coaching philosophy. Answer concisely and with authority. Always respond in English. Do not use <think> tags. The user may ask about any football topic: Premier League, Champions League, World Cup, player stats, match tactics, team formations, and more.`;

const SUGGESTIONS = [
  'How does a high press work?',
  'Best striker in Champions League history?',
  'Explain the offside rule simply.',
];

interface Entry {
  id: string;
  question: string;
  answer: string;
  streaming: boolean;
  elapsed?: number;
  toks?: number;
}

export default function MatchAIScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [noModel, setNoModel] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const currentRunRef = useRef<any>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadModel();
    return () => {
      mountedRef.current = false;
      clearNotification();
      if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
    };
  }, []);

  const loadModel = async () => {
    try {
      const synced = await syncModelsFromDisk();
      const model = synced.find((m: any) => m.modelType === 'text');
      if (!model) { setNoModel(true); return; }
      const mid = await llmManager.ensure(model, { ctx_size: 4096, device: 'auto' });
      if (mountedRef.current) setModelId(mid);
    } catch {
      if (mountedRef.current) setNoModel(true);
    }
  };

  const send = useCallback(async (question?: string) => {
    const q = (question ?? input).trim();
    if (!q || isGenerating || !modelId) return;
    setInput('');
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const entryId = `e-${Date.now()}`;
    const newEntry: Entry = { id: entryId, question: q, answer: '', streaming: true };
    setEntries(prev => [...prev, newEntry]);
    setIsGenerating(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    const history = entries.map(e => [
      { role: 'user' as const, content: e.question },
      { role: 'assistant' as const, content: e.answer },
    ]).flat();
    history.push({ role: 'user', content: q });

    try {
      const gp = await getGenParams();
      const t0 = Date.now();
      const run = completion({
        modelId,
        history: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        stream: true,
        captureThinking: false,
        generationParams: {
          predict: gp.maxTokens,
          temp: gp.temp,
          top_k: gp.top_k,
          top_p: gp.top_p,
          repeat_penalty: gp.repeat_penalty,
          reasoning_budget: 0 as 0,
        },
      });
      currentRunRef.current = run;
      registerInferenceCancel(() => {
        if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
      });
      showRunningNotification('AI Coach');

      let streamed = '';
      for await (const event of run.events) {
        if (event.type === 'contentDelta') {
          streamed += event.text;
          if (mountedRef.current) {
            setEntries(prev => prev.map(e => e.id === entryId ? { ...e, answer: streamed } : e));
            scrollRef.current?.scrollToEnd({ animated: false });
          }
        }
      }

      const [, stats] = await Promise.all([run.final, run.stats]);
      currentRunRef.current = null;
      clearNotification();

      const elapsed = Math.round((Date.now() - t0) / 100) / 10;
      if (mountedRef.current) {
        setEntries(prev => prev.map(e =>
          e.id === entryId ? { ...e, answer: streamed, streaming: false, elapsed, toks: stats?.generatedTokens } : e
        ));
        setIsGenerating(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      currentRunRef.current = null;
      clearNotification();
      if (mountedRef.current) {
        setEntries(prev => prev.map(e =>
          e.id === entryId
            ? { ...e, answer: err instanceof InferenceCancelledError ? (e.answer || '...') : 'Could not get a response. Try again.', streaming: false }
            : e
        ));
        setIsGenerating(false);
      }
    }
  }, [input, isGenerating, modelId, entries]);

  const accent = theme.accent;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <IconBack size={20} color={accent} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={[styles.headerBall, { backgroundColor: accent + '22' }]}>
            <IconBall size={14} color={accent} />
          </View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>AI Coach</Text>
          {modelId && <View style={[styles.liveDot, { backgroundColor: accent }]} />}
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Feed */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Empty state */}
        {entries.length === 0 && (
          <View style={styles.emptyState}>
            <View style={[styles.emptyLogoBox, { backgroundColor: accent + '14' }]}>
              <IconBall size={40} color={accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>Ask the AI Coach</Text>
            <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
              Tactics · Players · Clubs · Tournaments · History
            </Text>
            {noModel && (
              <View style={[styles.noModelCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.noModelText, { color: theme.textSecondary }]}>
                  No model downloaded. Go to Models to download one.
                </Text>
              </View>
            )}
            <View style={styles.suggestions}>
              {SUGGESTIONS.map(q => (
                <TouchableOpacity
                  key={q}
                  style={[styles.chip, { backgroundColor: theme.card, borderColor: theme.border }]}
                  onPress={() => send(q)}
                  disabled={isGenerating || !modelId}
                >
                  <Text style={[styles.chipText, { color: theme.text }]}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Q&A entries — match report style */}
        {entries.map(entry => (
          <View key={entry.id} style={styles.entryBlock}>
            {/* Question label */}
            <View style={styles.questionRow}>
              <Text style={[styles.questionLabel, { color: theme.textSecondary }]}>YOU</Text>
              <Text style={[styles.questionText, { color: theme.text }]}>{entry.question}</Text>
            </View>

            {/* Answer card — full-width report style */}
            <View style={[styles.answerCard, { backgroundColor: theme.card, borderColor: entry.streaming ? accent + '60' : theme.border }]}>
              <View style={[styles.answerBar, { backgroundColor: accent }]} />
              <View style={styles.answerContent}>
                <View style={styles.answerHeader}>
                  <Text style={[styles.answerLabel, { color: accent }]}>ANALYSIS</Text>
                  {entry.streaming && (
                    <View style={[styles.streamingDot, { backgroundColor: accent }]} />
                  )}
                </View>
                <Text style={[styles.answerText, { color: theme.text }]}>
                  {entry.answer || (entry.streaming ? 'Reading the game...' : '')}
                </Text>
                {!entry.streaming && entry.elapsed && (
                  <Text style={[styles.stat, { color: theme.textSecondary }]}>
                    {entry.elapsed}s
                    {entry.toks ? ` · ${Math.round(entry.toks / (entry.elapsed || 1))} tok/s` : ''}
                    {' · on-device'}
                  </Text>
                )}
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Input bar */}
      <View style={[styles.inputBar, {
        backgroundColor: theme.background,
        borderTopColor: theme.border,
        paddingBottom: insets.bottom + 8,
      }]}>
        <TextInput
          style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
          placeholder="Ask about football..."
          placeholderTextColor={theme.textSecondary}
          value={input}
          onChangeText={setInput}
          multiline
          editable={!isGenerating}
          onSubmitEditing={() => send()}
        />
        {isGenerating ? (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.error }]}
            onPress={() => { if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {}); }}
          >
            <IconStop size={18} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: accent, opacity: input.trim() && modelId ? 1 : 0.35 }]}
            onPress={() => send()}
            disabled={!input.trim() || !modelId}
          >
            <IconSend size={18} color={theme.accentFg} />
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
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBall: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  liveDot: { width: 6, height: 6, borderRadius: 3 },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 0 },

  emptyState: { paddingTop: 60, gap: 12, alignItems: 'center' },
  emptyLogoBox: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  emptySub: { fontSize: 14 },
  noModelCard: { borderRadius: 12, borderWidth: 1, padding: 14, width: '100%' },
  noModelText: { fontSize: 13, textAlign: 'center' },
  suggestions: { width: '100%', gap: 8, marginTop: 8 },
  chip: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  chipText: { fontSize: 14 },

  entryBlock: { marginBottom: 20, gap: 8 },
  questionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  questionLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 3, width: 32 },
  questionText: { flex: 1, fontSize: 15, fontWeight: '600', lineHeight: 22 },

  answerCard: {
    borderRadius: 14, borderWidth: 1,
    flexDirection: 'row', overflow: 'hidden',
  },
  answerBar: { width: 3 },
  answerContent: { flex: 1, padding: 14, gap: 8 },
  answerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  answerLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  streamingDot: { width: 6, height: 6, borderRadius: 3 },
  answerText: { fontSize: 15, lineHeight: 24 },
  stat: { fontSize: 10 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1,
  },
  input: {
    flex: 1, borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, maxHeight: 120,
  },
  actionBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
