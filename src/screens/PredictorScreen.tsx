import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { completion, cancel, InferenceCancelledError } from '@qvac/sdk';
import * as Haptics from 'expo-haptics';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconBack, IconTarget, IconStop } from '../components/Icons';
import { llmManager } from '../utils/modelManager';
import { syncModelsFromDisk, getGenParams } from '../utils/storage';
import { registerInferenceCancel, showRunningNotification, clearInferenceNotifications as clearNotification } from '../utils/bgNotification';

const SYSTEM_PROMPT = `You are Scout's Predictor — an on-device football match prediction AI. When given two teams, provide a structured prediction: likely score, which team wins and why, key factors (form, head-to-head, tactical matchup), and a confidence level (low/medium/high). Keep it tight — 150 words max. No fluff, no disclaimers. Be decisive. Always respond in English.`;

const TEAM_GROUPS = [
  {
    label: 'Europe',
    teams: ['Manchester City', 'Arsenal', 'Liverpool', 'Chelsea', 'Real Madrid', 'Barcelona', 'Bayern Munich', 'PSG', 'Juventus', 'AC Milan', 'Inter Milan', 'Atletico Madrid', 'Borussia Dortmund', 'Ajax'],
  },
  {
    label: 'International',
    teams: ['England', 'France', 'Germany', 'Spain', 'Brazil', 'Argentina', 'Portugal', 'Netherlands', 'Italy', 'Belgium', 'Uruguay', 'Colombia', 'Nigeria', 'Senegal', 'Japan', 'Morocco'],
  },
];

const ALL_TEAMS = TEAM_GROUPS.flatMap(g => g.teams);

export default function PredictorScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [teamA, setTeamA] = useState<string | null>(null);
  const [teamB, setTeamB] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<'A' | 'B' | null>(null);
  const [prediction, setPrediction] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [noModel, setNoModel] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const currentRunRef = useRef<any>(null);
  const mountedRef = useRef(true);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    mountedRef.current = true;
    loadModel();
    return () => {
      mountedRef.current = false;
      clearNotification();
      if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (isGenerating) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.6, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isGenerating]);

  const loadModel = async () => {
    try {
      const synced = await syncModelsFromDisk();
      const model = synced.find((m: any) => m.modelType === 'text');
      if (!model) { setNoModel(true); return; }
      const mid = await llmManager.ensure(model, { ctx_size: 2048, device: 'auto' });
      if (mountedRef.current) setModelId(mid);
    } catch {
      if (mountedRef.current) setNoModel(true);
    }
  };

  const predict = async () => {
    if (!teamA || !teamB || isGenerating || !modelId) return;
    setPrediction('');
    setElapsed(null);
    setIsGenerating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const prompt = `Predict the match: ${teamA} vs ${teamB}`;
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
          predict: 300,
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
      showRunningNotification('Predictor');

      let streamed = '';
      for await (const event of run.events) {
        if (event.type === 'contentDelta') {
          streamed += event.text;
          if (mountedRef.current) setPrediction(streamed);
        }
      }
      const [, stats] = await Promise.all([run.final, run.stats]);
      currentRunRef.current = null;
      clearNotification();
      const totalMs = Date.now() - genStart;
      if (mountedRef.current) {
        setElapsed(Math.round(totalMs / 100) / 10);
        setIsGenerating(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      currentRunRef.current = null;
      clearNotification();
      if (mountedRef.current) {
        if (!(err instanceof InferenceCancelledError)) {
          setPrediction('Prediction failed. Try again.');
        }
        setIsGenerating(false);
      }
    }
  };

  const stopPrediction = () => {
    if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
  };

  const accent = theme.accent;

  if (selecting) {
    const other = selecting === 'A' ? teamB : teamA;
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => setSelecting(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <IconBack size={20} color={accent} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Pick Team {selecting}</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, paddingBottom: insets.bottom + 20 }}>
          {TEAM_GROUPS.map(group => (
            <View key={group.label}>
              <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>{group.label}</Text>
              {group.teams.map(team => {
                const isOther = team === other;
                return (
                  <TouchableOpacity
                    key={team}
                    style={[styles.teamRow, { borderColor: theme.border, opacity: isOther ? 0.35 : 1 }]}
                    onPress={() => {
                      if (isOther) return;
                      if (selecting === 'A') setTeamA(team);
                      else setTeamB(team);
                      setSelecting(null);
                      setPrediction('');
                    }}
                    disabled={isOther}
                  >
                    <Text style={[styles.teamRowText, { color: theme.text }]}>{team}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <IconBack size={20} color={accent} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={[styles.headerDot, { backgroundColor: accent }]} />
          <Text style={[styles.headerTitle, { color: theme.text }]}>Predictor</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Team picker */}
        <View style={styles.matchup}>
          <TouchableOpacity
            style={[styles.teamCard, { backgroundColor: theme.card, borderColor: teamA ? accent : theme.border }]}
            onPress={() => setSelecting('A')}
          >
            <Text style={[styles.teamCardLabel, { color: theme.textSecondary }]}>Home</Text>
            <Text style={[styles.teamCardName, { color: teamA ? theme.text : theme.textSecondary }]}>
              {teamA ?? 'Pick team'}
            </Text>
          </TouchableOpacity>

          <View style={[styles.vsBox, { backgroundColor: theme.cardAlt }]}>
            <Text style={[styles.vsText, { color: theme.textSecondary }]}>VS</Text>
          </View>

          <TouchableOpacity
            style={[styles.teamCard, { backgroundColor: theme.card, borderColor: teamB ? accent : theme.border }]}
            onPress={() => setSelecting('B')}
          >
            <Text style={[styles.teamCardLabel, { color: theme.textSecondary }]}>Away</Text>
            <Text style={[styles.teamCardName, { color: teamB ? theme.text : theme.textSecondary }]}>
              {teamB ?? 'Pick team'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Predict button */}
        <TouchableOpacity
          style={[styles.predictBtn, {
            backgroundColor: isGenerating ? theme.error : accent,
            opacity: (teamA && teamB && modelId) || isGenerating ? 1 : 0.4,
          }]}
          onPress={isGenerating ? stopPrediction : predict}
          disabled={!isGenerating && (!teamA || !teamB || !modelId)}
        >
          {isGenerating ? (
            <Animated.View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pulseAnim }}>
              <IconStop size={18} color="#fff" />
              <Text style={[styles.predictBtnText, { color: '#fff' }]}>Stop</Text>
            </Animated.View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <IconTarget size={18} color={theme.accentFg} />
              <Text style={[styles.predictBtnText, { color: theme.accentFg }]}>Predict Match</Text>
            </View>
          )}
        </TouchableOpacity>

        {noModel && (
          <View style={[styles.noModelCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.noModelText, { color: theme.textSecondary }]}>
              No model downloaded. Go to Models to download one.
            </Text>
          </View>
        )}

        {/* Prediction result */}
        {prediction.length > 0 && (
          <View style={[styles.resultCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.resultHeader}>
              <View style={[styles.resultDot, { backgroundColor: accent }]} />
              <Text style={[styles.resultTitle, { color: theme.text }]}>
                {teamA} vs {teamB}
              </Text>
            </View>
            <Text style={[styles.resultText, { color: theme.text }]}>{prediction}</Text>
            {!isGenerating && elapsed && (
              <Text style={[styles.resultStat, { color: theme.textSecondary }]}>
                Generated in {elapsed}s · on-device
              </Text>
            )}
          </View>
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
  content: { padding: 16, gap: 16 },
  matchup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamCard: {
    flex: 1, borderRadius: 14, borderWidth: 1.5, padding: 16,
    alignItems: 'center', gap: 4,
  },
  teamCardLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  teamCardName: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  vsBox: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  vsText: { fontSize: 11, fontWeight: '800' },
  predictBtn: {
    borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
  },
  predictBtnText: { fontSize: 16, fontWeight: '800' },
  noModelCard: { borderRadius: 10, borderWidth: 1, padding: 14 },
  noModelText: { fontSize: 13, textAlign: 'center' },
  resultCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultDot: { width: 8, height: 8, borderRadius: 4 },
  resultTitle: { fontSize: 14, fontWeight: '700' },
  resultText: { fontSize: 15, lineHeight: 24 },
  resultStat: { fontSize: 11 },
  groupLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase',
    marginTop: 16, marginBottom: 6,
  },
  teamRow: { paddingVertical: 14, borderBottomWidth: 1 },
  teamRowText: { fontSize: 15, fontWeight: '500' },
});
