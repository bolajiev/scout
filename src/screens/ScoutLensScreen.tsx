import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { completion, cancel, InferenceCancelledError } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconBack, IconCamera, IconStop } from '../components/Icons';
import { llmManager } from '../utils/modelManager';
import { syncModelsFromDisk } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';
import { createSession, addMessage } from '../utils/historyDb';

const VISION_PROMPT = `You are Scout Lens — an on-device football vision AI. When shown an image, identify any football-related content: player jerseys and their numbers/teams, club badges/crests, stadium features, match scoreboard text, player cards, or trophies. Be specific: name the club if you can identify it from the badge or kit color. Keep your response concise and factual — under 100 words. If the image has no football content, say so briefly.`;

export default function ScoutLensScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [imagePath, setImagePath] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [noModel, setNoModel] = useState(false);

  const currentRunRef = useRef<any>(null);
  const mountedRef    = useRef(true);

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
      const vision = synced.find((m: any) => m.modelType === 'vision');
      if (!vision) { setNoModel(true); return; }
      const mid = await llmManager.ensure(vision, { ctx_size: 2048, device: 'auto' });
      if (mountedRef.current) setModelId(mid);
    } catch {
      if (mountedRef.current) setNoModel(true);
    }
  };

  const pickImage = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const uri = result.assets[0].uri;
      setImagePath(uri);
      setResult('');
      analyse(uri);
    } catch {}
  };

  const analyse = async (uri: string) => {
    if (!modelId || isAnalyzing) return;
    setIsAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showRunningNotification('Scout Lens');

    try {
      const run = completion({
        modelId,
        history: [
          { role: 'system', content: VISION_PROMPT },
          {
            role: 'user',
            content: 'What football content do you see in this image?',
            attachments: [{ path: uri }],
          } as any,
        ],
        stream: true,
        captureThinking: false,
        generationParams: { predict: 200, reasoning_budget: 0 as 0 },
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
          if (mountedRef.current && now - lastFlush > 50) {
            lastFlush = now;
            setResult(streamed);
          }
        }
      }
      if (mountedRef.current) setResult(streamed);
      await run.final;
      currentRunRef.current = null;
      clearNotification();

      // Save scan result to SQLite history
      if (streamed) {
        const sessionId = createSession('scoutlens', 'Scan — ' + new Date().toLocaleTimeString());
        addMessage(sessionId, 'user', `[image] ${uri}`);
        addMessage(sessionId, 'assistant', streamed);
      }

      if (mountedRef.current) {
        setIsAnalyzing(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      currentRunRef.current = null;
      clearNotification();
      if (mountedRef.current) {
        if (!(err instanceof InferenceCancelledError)) setResult('Could not analyse image. Try again.');
        setIsAnalyzing(false);
      }
    }
  };

  const accent = theme.accent;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: theme.border }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.headerDot, { backgroundColor: accent }]} />
          <Text style={[styles.headerTitle, { color: theme.text }]}>Scout Lens</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('History', { screen: 'scoutlens' })}
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

        {/* Image picker */}
        <TouchableOpacity
          style={[styles.pickerArea, {
            backgroundColor: theme.card,
            borderColor: isAnalyzing ? accent : imagePath ? accent + '80' : theme.border,
          }]}
          onPress={pickImage}
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
              <Text style={[styles.pickerHint, { color: theme.text }]}>Scan football content</Text>
              <Text style={[styles.pickerSub, { color: theme.textSecondary }]}>
                Jersey · Badge · Player card · Scoreboard
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {imagePath && (
          <TouchableOpacity
            style={[styles.changeBtn, { borderColor: theme.border }]}
            onPress={pickImage}
            disabled={isAnalyzing}
          >
            <Text style={[styles.changeBtnText, { color: theme.textSecondary }]}>Change image</Text>
          </TouchableOpacity>
        )}

        {/* Result */}
        {isAnalyzing && !result && (
          <View style={[styles.resultCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.resultText, { color: theme.textSecondary }]}>Analysing...</Text>
          </View>
        )}

        {result.length > 0 && (
          <View style={[styles.resultCard, { backgroundColor: theme.card, borderColor: accent + '40' }]}>
            <View style={[styles.resultBar, { backgroundColor: accent }]} />
            <View style={styles.resultContent}>
              <Text style={[styles.resultLabel, { color: accent }]}>Scout Lens</Text>
              <Text style={[styles.resultText, { color: theme.text }]}>{result}</Text>
              {!isAnalyzing && (
                <Text style={[styles.resultNote, { color: theme.textSecondary }]}>On-device · no internet</Text>
              )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerDot: { width: 7, height: 7, borderRadius: 3.5 },
  headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  historyBtn: { fontSize: 12, fontWeight: '600' },
  content: { padding: 16, gap: 14 },
  noModelCard: { borderRadius: 10, borderWidth: 1, padding: 14 },
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
  changeBtn: { borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: 'center' },
  changeBtnText: { fontSize: 13, fontWeight: '600' },
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
