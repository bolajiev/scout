import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Animated, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { completion, cancel, InferenceCancelledError } from '@qvac/sdk';
import {
  showRunningNotification, clearInferenceNotifications,
  registerInferenceCancel, unregisterInferenceCancel,
} from '../utils/bgNotification';
import { llmManager } from '../utils/modelManager';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { syncModelsFromDisk, getSettings, getDefaultModelId, toPath } from '../utils/storage';
import { logInference } from '../utils/auditLogger';
import { SYSTEM_PROMPTS, MODEL_KEYS } from '../utils/models';
import { IconBack, IconSend } from '../components/Icons';
import MarkdownText from '../components/MarkdownText';
import CopyButton from '../components/CopyButton';

interface Msg { id: string; role: 'user' | 'assistant'; text: string; streaming?: boolean; }

export default function QuickChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const preselectedModelId: string | undefined = route.params?.modelId;
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();
  const inputPadBot = useRef(new Animated.Value(0)).current;
  const insetBottomRef = useRef(0);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [modelName, setModelName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [noModel, setNoModel] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const modelIdRef = useRef<string | null>(null);
  const runRef = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    insetBottomRef.current = insets.bottom;
    inputPadBot.setValue(Math.max(insets.bottom, 8));
  }, [insets.bottom]);

  useEffect(() => {
    loadOnMount();
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      Animated.timing(inputPadBot, { toValue: 8, duration: e.duration || 250, useNativeDriver: false }).start();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      Animated.timing(inputPadBot, { toValue: Math.max(insetBottomRef.current, 8), duration: 200, useNativeDriver: false }).start();
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      unregisterInferenceCancel();
      void clearInferenceNotifications();
      if (runRef.current) cancel({ requestId: runRef.current.requestId }).catch(() => {});
    };
  }, []);

  const loadOnMount = async () => {
    setLoading(true);
    try {
      const synced = await syncModelsFromDisk();
      // Prefer preselected → user's default → text-fast → text-health → any
      const defaultId = await getDefaultModelId();
      const preferredId = preselectedModelId ?? defaultId ?? MODEL_KEYS.TEXT_HEALTH;
      const model = synced.find(m => m.id === preferredId)
        ?? synced.find(m => m.id === MODEL_KEYS.TEXT_HEALTH)
        ?? synced.find(m => m.id === MODEL_KEYS.TEXT_FAST)
        ?? synced.find(m => m.modelType === 'text')
        ?? synced[0];
      if (!model) { setNoModel(true); setLoading(false); return; }
      setModelName(model.name);
      const settings = await getSettings();
      const device = settings.accelerator === 'gpu' ? 'gpu' : 'cpu';
      const modelConfig: any = { ctx_size: 1024, device };
      if (model.projectionModelSrc) modelConfig.projectionModelSrc = toPath(model.projectionModelSrc);
      const mid = await llmManager.ensure(model, modelConfig, setLoadProgress);
      modelIdRef.current = mid;
    } catch (err: any) {
      const raw = err?.message || err?.toString() || 'Unknown error';
      const msg = raw.replace(/file:\/\/[^\s,]*/g, '[model]');
      setLoadError(msg);
      setNoModel(true);
    }
    setLoading(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || isTyping || !modelIdRef.current) return;
    setInput('');
    const mid = modelIdRef.current;
    const userMsg: Msg = { id: Date.now().toString(), role: 'user', text };
    const all = [...messages, userMsg];
    setMessages(all);
    setIsTyping(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

    const phId = 'ai-' + Date.now();
    const genStart = Date.now();
    setMessages(prev => [...prev, { id: phId, role: 'assistant', text: '', streaming: true }]);

    try {
      const history: any[] = [
        { role: 'system', content: SYSTEM_PROMPTS.quickchat },
        ...all.map(m => ({ role: m.role, content: m.text })),
      ];
      const run = completion({
        modelId: mid,
        history,
        stream: true,
        captureThinking: false,
        generationParams: { predict: 512, temp: 0.7, top_k: 20, reasoning_budget: 0 as 0 },
      });
      runRef.current = run;
      registerInferenceCancel(() => {
        if (runRef.current) cancel({ requestId: runRef.current.requestId }).catch(() => {});
      });
      void showRunningNotification('Quick Chat');
      let out = '';
      let firstTokenMs = -1;
      for await (const ev of run.events) {
        if ((ev as any).type === 'contentDelta') {
          if (firstTokenMs < 0) firstTokenMs = Date.now();
          out += (ev as any).text;
          setMessages(prev => prev.map(m => m.id === phId ? { ...m, text: out } : m));
          scrollRef.current?.scrollToEnd({ animated: false });
        }
      }
      const [, stats] = await Promise.all([run.final, run.stats]);
      runRef.current = null;
      const totalMs = Date.now() - genStart;
      const ttftMs = firstTokenMs > 0 ? firstTokenMs - genStart : totalMs;
      logInference('QuickChat', modelName, ttftMs, totalMs, stats?.generatedTokens ?? 0).catch(() => {});
      unregisterInferenceCancel();
      void clearInferenceNotifications();
      setMessages(prev => prev.map(m => m.id === phId ? { ...m, streaming: false } : m));
    } catch (e) {
      runRef.current = null;
      unregisterInferenceCancel();
      void clearInferenceNotifications();
      if (!(e instanceof InferenceCancelledError)) {
        setMessages(prev => prev.map(m => m.id === phId ? { ...m, text: 'Something went wrong.', streaming: false } : m));
      }
    } finally {
      setIsTyping(false);
    }
  };

  const canSend = !!input.trim() && !isTyping && !loading && !!modelIdRef.current;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <IconBack size={18} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.brand}>
          <View style={[styles.brandDot, { backgroundColor: theme.accent }]} />
          <Text style={[styles.brandName, { color: theme.text }]}>Peek</Text>
        </View>
        {messages.length > 0
          ? <TouchableOpacity onPress={() => setMessages([])} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.clearBtn, { color: theme.textSecondary }]}>Clear</Text>
            </TouchableOpacity>
          : <View style={{ width: 40 }} />}
      </View>

      {/* Progress bar */}
      {loading && (
        <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
          <View style={[styles.progressFill, { backgroundColor: theme.accent, width: `${loadProgress || 8}%` }]} />
        </View>
      )}

      {/* Model bar */}
      {!loading && modelName ? (
        <View style={[styles.modelBar, { borderBottomColor: theme.border }]}>
          <View style={[styles.modelDot, { backgroundColor: theme.accent }]} />
          <Text style={[styles.modelBarText, { color: theme.textSecondary }]}>
            Running · {modelName} · on-device
          </Text>
        </View>
      ) : null}

      {/* No model / error state */}
      {noModel && !loading && (
        <View style={styles.noModelBox}>
          <Text style={[styles.noModelTitle, { color: theme.text }]}>{loadError ? 'Load Failed' : 'No Model'}</Text>
          <Text selectable style={[styles.noModelSub, { color: loadError ? theme.error : theme.textSecondary }]}>{loadError || 'Download a model first to use Quick Chat.'}</Text>
          {loadError && (
            <TouchableOpacity style={[styles.retryBtn, { backgroundColor: theme.accent }]} onPress={() => { setNoModel(false); setLoadError(null); loadOnMount(); }}>
              <Text style={[styles.retryBtnText, { color: '#000' }]}>Retry</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }]} onPress={() => navigation.navigate('Models')}>
            <Text style={[styles.retryBtnText, { color: theme.text }]}>Manage Models</Text>
          </TouchableOpacity>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.keyboardFlex}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        {!noModel && (
          <ScrollView
            ref={scrollRef}
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 && !loading && (
              <View style={styles.empty}>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>Quick Chat</Text>
                <Text style={[styles.emptySub, { color: theme.textSecondary }]}>Ask anything — fully on-device, no cloud.</Text>
              </View>
            )}
            {messages.map(msg => (
              <View key={msg.id} style={[styles.msgRow, msg.role === 'user' && styles.msgRowUser]}>
                <View style={[
                  styles.bubble,
                  msg.role === 'user'
                    ? { backgroundColor: theme.accent, borderBottomRightRadius: 4 }
                    : { backgroundColor: theme.cardAlt, borderBottomLeftRadius: 4 },
                ]}>
                  {msg.role === 'assistant' && !msg.streaming ? (
                    <MarkdownText color={theme.text} fontSize={14} lineHeight={21}>{msg.text}</MarkdownText>
                  ) : (
                    <Text style={[styles.bubbleText, { color: msg.role === 'user' ? theme.accentFg : theme.text }]}>
                      {msg.text}{msg.streaming ? '▍' : ''}
                    </Text>
                  )}
                </View>
                {msg.role === 'assistant' && !msg.streaming && msg.text ? (
                  <View style={styles.msgActions}>
                    <CopyButton text={msg.text} color={theme.textSecondary} size={11} />
                  </View>
                ) : null}
              </View>
            ))}
            <View style={{ height: 12 }} />
          </ScrollView>
        )}

        {/* Input */}
        {!noModel && (
          <Animated.View style={[styles.inputWrap, { borderTopColor: theme.border, paddingBottom: inputPadBot }]}>
            <TextInput
              style={[styles.input, { backgroundColor: theme.cardAlt, borderColor: theme.border, color: theme.text }]}
              placeholder={loading ? 'Loading model...' : 'Message Peek...'}
              placeholderTextColor={theme.textSecondary}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={2000}
              editable={!loading}
              onSubmitEditing={send}
              returnKeyType="send"
              blurOnSubmit={false}
            />
            {isTyping ? (
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: theme.error }]}
                onPress={() => { if (runRef.current) void cancel({ requestId: runRef.current.requestId }).catch(() => {}); }}
                activeOpacity={0.8}
              >
                <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: '#fff' }} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: canSend ? theme.accent : theme.cardAlt }]}
                onPress={send}
                disabled={!canSend}
                activeOpacity={0.8}
              >
                <IconSend size={16} color={canSend ? theme.accentFg : theme.textSecondary} />
              </TouchableOpacity>
            )}
          </Animated.View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  keyboardFlex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 13, borderBottomWidth: 1,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandDot: { width: 7, height: 7, borderRadius: 3.5 },
  brandName: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  clearBtn: { fontSize: 13, fontWeight: '600' },
  progressTrack: { height: 3 },
  progressFill: { height: 3 },
  modelBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: 1,
  },
  modelDot: { width: 6, height: 6, borderRadius: 3 },
  modelBarText: { fontSize: 11 },
  messages: { flex: 1 },
  messagesContent: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, paddingVertical: 80 },
  emptyTitle: { fontSize: 22, fontWeight: '800' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  msgRow: { maxWidth: '82%', alignSelf: 'flex-start', gap: 4 },
  msgRowUser: { alignSelf: 'flex-end' },
  msgActions: { flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 2 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 11 },
  bubbleText: { fontSize: 14, lineHeight: 21 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    padding: 12, borderTopWidth: 1,
  },
  input: {
    flex: 1, borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 11, fontSize: 14,
    maxHeight: 100, lineHeight: 20,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  noModelBox: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 32, gap: 12,
  },
  noModelTitle: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  noModelSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, marginTop: 4,
    minWidth: 160, alignItems: 'center',
  },
  retryBtnText: { fontSize: 15, fontWeight: '700' },
});
