import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Animated,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { completion, cancel, InferenceCancelledError } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconCamera, IconPhoto, IconStop, IconBack } from '../components/Icons';
import { llmManager } from '../utils/modelManager';
import { syncModelsFromDisk, toPath } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';
import { createSession, addMessage } from '../utils/historyDb';
import { logInference } from '../utils/auditLogger';

const VISION_PROMPT = `You are Scout Lens — an on-device football vision AI. Identify any football-related content in the image: player jerseys and their numbers/teams, club badges/crests, stadium features, scoreboard text, player cards, trophies.

Commit to your best identification — name the club or country if the badge, kit colours, or design point to one, and say what gives it away. Never respond with "I can't identify" or "I'm not sure" — give your strongest read and the visual evidence. Keep it under 100 words. If the image truly has no football content, say what it shows instead in one line.`;

export default function ScoutLensScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [imagePath, setImagePath] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState('');      // streaming buffer for the in-flight answer
  const [turns, setTurns] = useState<{ q: string; a: string }[]>([]);
  const sessionDbRef = useRef<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [noModel, setNoModel] = useState(false);

  const currentRunRef  = useRef<any>(null);
  const mountedRef     = useRef(true);
  const modelNameRef   = useRef<string>('');

  // Scan line animation
  const scanY    = useRef(new Animated.Value(0)).current;
  const scanLoop = useRef<Animated.CompositeAnimation | null>(null);
  // Bracket pulse when idle (no image)
  const bracketPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bracketPulse, { toValue: 0.6, duration: 900, useNativeDriver: true }),
      Animated.timing(bracketPulse, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    if (isAnalyzing) {
      scanY.setValue(0);
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(scanY, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(scanY, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]));
      scanLoop.current = loop;
      loop.start();
    } else {
      scanLoop.current?.stop();
      scanY.setValue(0);
    }
  }, [isAnalyzing]);

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
      // If a vision model is already resident, keep using it; otherwise
      // first in catalog order (Gemma before the light SmolVLM option)
      const visions = synced.filter((m: any) => m.modelType === 'vision');
      const vision = visions.find((m: any) => m.id === llmManager.getLoadedModelId()) ?? visions[0];
      if (!vision) { setNoModel(true); return; }
      const mid = await llmManager.ensure(vision, { ctx_size: 2048, device: 'auto', projectionModelSrc: vision.projectionModelSrc });
      modelNameRef.current = vision.name;
      if (mountedRef.current) setModelId(mid);
    } catch {
      if (mountedRef.current) setNoModel(true);
    }
  };

  const pickImage = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const uri = res.assets[0].uri;
      setImagePath(uri);
      setResult('');
      setTurns([]);
      sessionDbRef.current = null;
      await runVision(question.trim() || 'What football content do you see in this image?', uri);
    } catch {}
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') return;
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const uri = res.assets[0].uri;
      setImagePath(uri);
      setResult('');
      setTurns([]);
      sessionDbRef.current = null;
      await runVision(question.trim() || 'What football content do you see in this image?', uri);
    } catch {}
  };

  const askFollowUp = () => {
    const q = question.trim();
    if (!q || !imagePath || isAnalyzing) return;
    setQuestion('');
    runVision(q);
  };

  // One vision conversation per image: the first turn carries the image
  // attachment, follow-up questions reuse the same conversation history.
  const runVision = async (userQ: string, freshUri?: string) => {
    const uri = freshUri ?? imagePath;
    if (!uri || !modelId || isAnalyzing) return;
    const baseTurns = freshUri ? [] : turns;
    setIsAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showRunningNotification('Scout Lens');

    const history: any[] = [{ role: 'system', content: VISION_PROMPT }];
    baseTurns.forEach((t, i) => {
      history.push(
        i === 0
          // QVAC needs a bare filesystem path — file:// URIs fail to load
          ? { role: 'user', content: t.q, attachments: [{ path: toPath(uri) }] }
          : { role: 'user', content: t.q },
      );
      history.push({ role: 'assistant', content: t.a });
    });
    history.push(
      baseTurns.length === 0
        ? { role: 'user', content: userQ, attachments: [{ path: toPath(uri) }] }
        : { role: 'user', content: userQ },
    );

    const genStart = Date.now();
    try {
      const run = completion({
        modelId,
        history,
        stream: true,
        captureThinking: false,
        generationParams: { predict: 220, reasoning_budget: 0 as 0 },
      });
      currentRunRef.current = run;
      registerInferenceCancel(() => {
        if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
      });

      let streamed = '';
      let lastFlush = 0;
      for await (const event of run.events) {
        if (event.type === 'contentDelta') {
          streamed += event.text;
          const now = Date.now();
          if (mountedRef.current && now - lastFlush > 100) {
            lastFlush = now;
            setResult(streamed);
          }
        }
      }
      const [, stats] = await Promise.all([run.final, run.stats]);
      currentRunRef.current = null;
      clearNotification();

      const totalMs = Date.now() - genStart;
      logInference('scoutlens', modelNameRef.current, stats?.timeToFirstToken ?? 0, totalMs, stats?.generatedTokens ?? 0).catch(() => {});

      // Save to SQLite history: one session per image, follow-ups append
      if (streamed) {
        try {
          if (!sessionDbRef.current) {
            sessionDbRef.current = createSession('scoutlens', userQ.length < 60 && !userQ.startsWith('What football') ? userQ : 'Scan — ' + new Date().toLocaleTimeString());
            addMessage(sessionDbRef.current, 'user', `[image] ${uri}`);
          } else {
            addMessage(sessionDbRef.current, 'user', userQ);
          }
          addMessage(sessionDbRef.current, 'assistant', streamed);
        } catch (e) {
          console.warn('[ScoutLens] DB write:', e);
        }
      }

      if (mountedRef.current) {
        setTurns([...baseTurns, { q: userQ, a: streamed }]);
        setResult('');
        setIsAnalyzing(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      currentRunRef.current = null;
      clearNotification();
      if (mountedRef.current) {
        if (!(err instanceof InferenceCancelledError)) {
          setTurns([...baseTurns, { q: userQ, a: 'Could not analyse the image. Try again.' }]);
        }
        setResult('');
        setIsAnalyzing(false);
      }
    }
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
          <View style={[styles.headerDot, { backgroundColor: accent }]} />
          <Text style={[styles.headerTitle, { color: theme.text }]}>Scout Lens</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('History', { tab: 'scoutlens' })}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.historyBtn, { color: theme.textSecondary }]}>History</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {noModel && (
          <View style={[styles.noModelCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.noModelText, { color: theme.textSecondary }]}>
              No vision model downloaded. Go to Models and download a vision model.
            </Text>
          </View>
        )}

        {/* Image picker — tap to open camera by default */}
        <TouchableOpacity
          style={[styles.pickerArea, {
            backgroundColor: theme.card,
            borderColor: isAnalyzing ? accent : imagePath ? accent + '80' : theme.border,
          }]}
          onPress={imagePath ? pickImage : takePhoto}
          disabled={isAnalyzing}
          activeOpacity={0.8}
        >
          {imagePath ? (
            <View style={styles.imageWrap}>
              <Image source={{ uri: imagePath }} style={styles.previewImage} resizeMode="cover" />
              {/* Animated scan line over image during analysis */}
              {isAnalyzing && (
                <Animated.View
                  style={[styles.scanLine, {
                    backgroundColor: accent,
                    transform: [{ translateY: scanY.interpolate({ inputRange: [0, 1], outputRange: [0, 200] }) }],
                  }]}
                />
              )}
              {/* Corner brackets overlay */}
              <View style={[styles.bracketTL, { borderColor: accent }]} />
              <View style={[styles.bracketTR, { borderColor: accent }]} />
              <View style={[styles.bracketBL, { borderColor: accent }]} />
              <View style={[styles.bracketBR, { borderColor: accent }]} />
            </View>
          ) : (
            <View style={styles.pickerEmpty}>
              {/* Pulsing brackets idle state */}
              <Animated.View style={[styles.idleBracketWrap, { opacity: bracketPulse }]}>
                <View style={[styles.bracketTL, { borderColor: accent }]} />
                <View style={[styles.bracketTR, { borderColor: accent }]} />
                <View style={[styles.bracketBL, { borderColor: accent }]} />
                <View style={[styles.bracketBR, { borderColor: accent }]} />
                {/* Football pitch centre circle hint */}
                <View style={[styles.pitchCircle, { borderColor: accent + '30' }]} />
                <View style={[styles.pitchLine, { backgroundColor: accent + '20' }]} />
                <IconCamera size={32} color={accent + '80'} />
              </Animated.View>
              <Text style={[styles.pickerHint, { color: theme.text }]}>Tap to open camera</Text>
              <Text style={[styles.pickerSub, { color: theme.textSecondary }]}>
                Jersey · Badge · Player card · Scoreboard
              </Text>
              <Text style={[styles.pickerSub, { color: accent + '80' }]}>or use Gallery below</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Camera / Gallery row */}
        <View style={styles.sourceRow}>
          <TouchableOpacity
            style={[styles.sourceBtn, { backgroundColor: theme.card, borderColor: isAnalyzing ? theme.border : accent + '60' }]}
            onPress={takePhoto}
            disabled={isAnalyzing}
            activeOpacity={0.8}
          >
            <IconCamera size={20} color={isAnalyzing ? theme.border : accent} />
            <Text style={[styles.sourceBtnText, { color: theme.text }]}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sourceBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
            onPress={pickImage}
            disabled={isAnalyzing}
            activeOpacity={0.8}
          >
            <IconPhoto size={20} color={isAnalyzing ? theme.border : theme.textSecondary} />
            <Text style={[styles.sourceBtnText, { color: theme.text }]}>Gallery</Text>
          </TouchableOpacity>
        </View>

        {/* Question / follow-up input — conversation continues on one image */}
        <View style={styles.askRow}>
          <TextInput
            style={[styles.questionInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
            placeholder={turns.length > 0 ? 'Ask a follow-up about this image...' : 'Ask about the image (optional)'}
            placeholderTextColor={theme.textSecondary}
            value={question}
            onChangeText={setQuestion}
            editable={!isAnalyzing}
            returnKeyType="send"
            onSubmitEditing={askFollowUp}
          />
          {turns.length > 0 && (
            <TouchableOpacity
              style={[styles.askBtn, { backgroundColor: accent, opacity: question.trim() && !isAnalyzing ? 1 : 0.35 }]}
              onPress={askFollowUp}
              disabled={!question.trim() || isAnalyzing}
            >
              <Text style={styles.askBtnText}>Ask</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Finished turns — Q&A stack for this image */}
        {turns.map((t, i) => (
          <View key={i} style={[styles.resultCard, { backgroundColor: theme.card, borderColor: accent + '40' }]}>
            <View style={[styles.resultBar, { backgroundColor: accent }]} />
            <View style={styles.resultContent}>
              <Text style={[styles.resultLabel, { color: accent }]} numberOfLines={2}>
                {t.q.startsWith('What football') ? 'Scout Lens' : t.q}
              </Text>
              <Text selectable style={[styles.resultText, { color: theme.text }]}>{t.a}</Text>
              <Text style={[styles.resultNote, { color: theme.textSecondary }]}>On-device · no internet</Text>
            </View>
          </View>
        ))}

        {/* In-flight answer */}
        {isAnalyzing && (
          <View style={[styles.resultCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[styles.resultBar, { backgroundColor: accent }]} />
            <View style={styles.resultContent}>
              <Text style={[styles.resultText, { color: result ? theme.text : theme.textSecondary }]}>
                {result || 'Analysing...'}
              </Text>
            </View>
          </View>
        )}

        {isAnalyzing && (
          <TouchableOpacity
            style={[styles.stopBtn, { backgroundColor: theme.error }]}
            onPress={() => {
              if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
            }}
          >
            <IconStop size={16} color="#fff" />
            <Text style={styles.stopBtnText}>Stop</Text>
          </TouchableOpacity>
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
  headerDot: { width: 7, height: 7, borderRadius: 3.5 },
  headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  historyBtn: { fontSize: 12, fontWeight: '600' },
  content: { padding: 16, gap: 14 },
  noModelCard: { borderRadius: 10, borderWidth: 1, padding: 14 },
  askRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  questionInput: {
    flex: 1, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, lineHeight: 19,
  },
  askBtn: { borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 },
  askBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  noModelText: { fontSize: 13, textAlign: 'center' },
  pickerArea: {
    borderRadius: 18, borderWidth: 1.5,
    minHeight: 220, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  pickerEmpty: { alignItems: 'center', gap: 10, padding: 36, width: '100%' },
  idleBracketWrap: {
    width: 110, height: 110, alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  // Bracket corners
  bracketTL: { position: 'absolute', top: 0, left: 0, width: 22, height: 22, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderRadius: 3 },
  bracketTR: { position: 'absolute', top: 0, right: 0, width: 22, height: 22, borderTopWidth: 2.5, borderRightWidth: 2.5, borderRadius: 3 },
  bracketBL: { position: 'absolute', bottom: 0, left: 0, width: 22, height: 22, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderRadius: 3 },
  bracketBR: { position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderRadius: 3 },
  // Football pitch decorations on idle state
  pitchCircle: {
    position: 'absolute', width: 50, height: 50, borderRadius: 25, borderWidth: 1,
  },
  pitchLine: {
    position: 'absolute', width: '80%', height: 1,
  },
  pickerHint: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  pickerSub: { fontSize: 12, textAlign: 'center' },
  imageWrap: { width: '100%', position: 'relative' },
  previewImage: { width: '100%', height: 280 },
  // Animated scan line
  scanLine: {
    position: 'absolute', left: 0, right: 0, height: 2, opacity: 0.85,
    shadowColor: '#22c55e', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 6,
  },
  sourceRow: { flexDirection: 'row', gap: 10 },
  sourceBtn: {
    flex: 1, borderRadius: 14, borderWidth: 1,
    paddingVertical: 14, alignItems: 'center', gap: 4,
  },
  sourceBtnText: { fontSize: 14, fontWeight: '700' },
  resultCard: {
    borderRadius: 14, borderWidth: 1, flexDirection: 'row', overflow: 'hidden',
  },
  resultBar: { width: 4 },
  resultContent: { flex: 1, padding: 16, gap: 6 },
  resultLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  resultText: { fontSize: 15, lineHeight: 24 },
  resultNote: { fontSize: 11 },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10,
    paddingVertical: 12, justifyContent: 'center',
  },
  stopBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
