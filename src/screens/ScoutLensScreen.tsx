import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
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
      for await (const event of run.events) {
        if (event.type === 'contentDelta') {
          streamed += event.text;
          if (mountedRef.current) setResult(streamed);
        }
      }
      await run.final;
      currentRunRef.current = null;
      clearNotification();
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
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <IconBack size={20} color={accent} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={[styles.headerDot, { backgroundColor: accent }]} />
          <Text style={[styles.headerTitle, { color: theme.text }]}>Scout Lens</Text>
        </View>
        <View style={{ width: 40 }} />
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
            borderColor: imagePath ? accent : theme.border,
          }]}
          onPress={pickImage}
          disabled={isAnalyzing}
        >
          {imagePath ? (
            <Image source={{ uri: imagePath }} style={styles.previewImage} resizeMode="cover" />
          ) : (
            <View style={styles.pickerEmpty}>
              <IconCamera size={40} color={theme.textSecondary} />
              <Text style={[styles.pickerHint, { color: theme.textSecondary }]}>
                Tap to pick an image
              </Text>
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
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerDot: { width: 7, height: 7, borderRadius: 3.5 },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  content: { padding: 16, gap: 14 },
  noModelCard: { borderRadius: 10, borderWidth: 1, padding: 14 },
  noModelText: { fontSize: 13, textAlign: 'center' },
  pickerArea: {
    borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed',
    minHeight: 220, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  pickerEmpty: { alignItems: 'center', gap: 8, padding: 32 },
  pickerHint: { fontSize: 16, fontWeight: '600' },
  pickerSub: { fontSize: 12 },
  previewImage: { width: '100%', height: 280 },
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
