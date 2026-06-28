import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Keyboard, AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { completion, cancel, InferenceCancelledError } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconBack, IconSend, IconStop } from '../components/Icons';
import { llmManager } from '../utils/modelManager';
import { syncModelsFromDisk, getGenParams } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';

const SYSTEM_PROMPT = `You are Scout's AI Coach — a world-class football analyst running fully on-device. You know tactics, player profiles, club history, tournament formats, transfer news, and coaching philosophy. Answer concisely and with authority. Always respond in English. Do not use <think> tags. The user may ask about any football topic: Premier League, Champions League, World Cup, player stats, match tactics, team formations, and more.`;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  elapsed?: number;
  tokens?: number;
}

export default function MatchAIScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
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
      if (currentRunRef.current) {
        cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
      }
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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating || !modelId) return;
    setInput('');
    Keyboard.dismiss();

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', text };
    const placeholderId = `a-${Date.now()}`;
    const placeholder: Message = { id: placeholderId, role: 'assistant', text: '', streaming: true };
    setMessages(prev => [...prev, userMsg, placeholder]);
    setIsGenerating(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    const history = messages.map(m => ({ role: m.role, content: m.text }));
    history.push({ role: 'user', content: text });

    try {
      const gp = await getGenParams();
      const genStart = Date.now();
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
            setMessages(prev => prev.map(m =>
              m.id === placeholderId ? { ...m, text: streamed } : m
            ));
            scrollRef.current?.scrollToEnd({ animated: false });
          }
        }
      }

      const [, stats] = await Promise.all([run.final, run.stats]);
      currentRunRef.current = null;
      clearNotification();

      const totalMs = Date.now() - genStart;
      const elapsed = Math.round(totalMs / 100) / 10;

      if (mountedRef.current) {
        setMessages(prev => prev.map(m =>
          m.id === placeholderId
            ? { ...m, text: streamed, streaming: false, elapsed, tokens: stats?.generatedTokens }
            : m
        ));
        setIsGenerating(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      currentRunRef.current = null;
      clearNotification();
      if (err instanceof InferenceCancelledError) {
        if (mountedRef.current) {
          setMessages(prev => prev.map(m =>
            m.id === placeholderId ? { ...m, text: m.text || '...', streaming: false } : m
          ));
        }
      } else {
        if (mountedRef.current) {
          setMessages(prev => prev.map(m =>
            m.id === placeholderId
              ? { ...m, text: 'Something went wrong. Try again.', streaming: false }
              : m
          ));
        }
      }
      if (mountedRef.current) setIsGenerating(false);
    }
  }, [input, isGenerating, modelId, messages]);

  const stopGeneration = () => {
    if (currentRunRef.current) {
      cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
    }
  };

  const bg = theme.background;
  const accent = theme.accent;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <IconBack size={20} color={accent} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={[styles.headerDot, { backgroundColor: accent }]} />
          <Text style={[styles.headerTitle, { color: theme.text }]}>AI Coach</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>Ask anything about football</Text>
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
            {['How does a high press work?', 'Best striker in Champions League history?', 'Explain the offside rule simply'].map(q => (
              <TouchableOpacity
                key={q}
                style={[styles.suggestion, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => { setInput(q); }}
              >
                <Text style={[styles.suggestionText, { color: theme.text }]}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {messages.map(msg => (
          <View key={msg.id} style={[
            styles.msgRow,
            msg.role === 'user' ? styles.msgRowUser : styles.msgRowAI,
          ]}>
            <View style={[
              styles.bubble,
              msg.role === 'user'
                ? [styles.bubbleUser, { backgroundColor: accent }]
                : [styles.bubbleAI, { backgroundColor: theme.card, borderColor: theme.border }],
            ]}>
              <Text style={[
                styles.bubbleText,
                { color: msg.role === 'user' ? theme.accentFg : theme.text },
              ]}>
                {msg.text || (msg.streaming ? '...' : '')}
              </Text>
              {!msg.streaming && msg.elapsed && msg.role === 'assistant' && (
                <Text style={[styles.stat, { color: theme.textSecondary }]}>
                  {msg.elapsed}s{msg.tokens ? ` · ${Math.round(msg.tokens / (msg.elapsed || 1))} tok/s` : ''}
                </Text>
              )}
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
          onSubmitEditing={send}
          editable={!isGenerating}
        />
        {isGenerating ? (
          <TouchableOpacity style={[styles.sendBtn, { backgroundColor: theme.error }]} onPress={stopGeneration}>
            <IconStop size={18} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: accent, opacity: input.trim() && modelId ? 1 : 0.4 }]}
            onPress={send}
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
  headerDot: { width: 7, height: 7, borderRadius: 3.5 },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 8 },
  emptyState: { paddingTop: 48, gap: 12, alignItems: 'center' },
  emptyTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  emptySub: { fontSize: 14, textAlign: 'center' },
  noModelCard: { borderRadius: 10, borderWidth: 1, padding: 14, width: '100%', marginTop: 8 },
  noModelText: { fontSize: 13, textAlign: 'center' },
  suggestion: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, width: '100%' },
  suggestionText: { fontSize: 14 },
  msgRow: { flexDirection: 'row', marginBottom: 4 },
  msgRowUser: { justifyContent: 'flex-end' },
  msgRowAI: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: 16, padding: 12, gap: 6 },
  bubbleUser: { borderBottomRightRadius: 4 },
  bubbleAI: { borderWidth: 1, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  stat: { fontSize: 10 },
  inputBar: { borderTopWidth: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  input: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
