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

const SYSTEM_PROMPT = `You are Scout's Predictor — an on-device football match prediction AI. Always respond in EXACTLY this format, no deviation:

WINNER: [team name]
SCORE: [e.g. 2-1]
CONFIDENCE: [Low/Medium/High]
---
[2-3 sentences: key factors, head-to-head, tactical notes. No fluff. Be decisive.]

Do not add anything before WINNER or after the analysis. Always respond in English.`;

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

export default function PredictorScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [teamA, setTeamA] = useState<string | null>(null);
  const [teamB, setTeamB] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<'A' | 'B' | null>(null);
  const [prediction, setPrediction] = useState('');
  const [parsed, setParsed] = useState<{ winner: string; score: string; confidence: string; analysis: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [noModel, setNoModel] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const currentRunRef = useRef<any>(null);
  const mountedRef = useRef(true);

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
    return () => {
      mountedRef.current = false;
      clearNotification();
      loadLoop.current?.stop();
      if (currentRunRef.current) cancel({ requestId: currentRunRef.current.requestId }).catch(() => {});
    };
  }, []);

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

  const loadModel = async () => {
    try {
      const synced = await syncModelsFromDisk();
      const model = synced.find((m: any) => m.modelType === 'text');
      if (!model) {
        if (mountedRef.current) { setNoModel(true); setModelLoading(false); }
        return;
      }
      const mid = await llmManager.ensure(model, { ctx_size: 2048, device: 'auto' });
      if (mountedRef.current) { setModelId(mid); setModelLoading(false); }
    } catch {
      if (mountedRef.current) { setNoModel(true); setModelLoading(false); }
    }
  };

  const parsePrediction = (text: string) => {
    const lines = text.split('\n').map(l => l.trim());
    const winner = lines.find(l => l.startsWith('WINNER:'))?.replace('WINNER:', '').trim() ?? '';
    const score = lines.find(l => l.startsWith('SCORE:'))?.replace('SCORE:', '').trim() ?? '';
    const confidence = lines.find(l => l.startsWith('CONFIDENCE:'))?.replace('CONFIDENCE:', '').trim() ?? '';
    const sepIdx = lines.indexOf('---');
    const analysis = sepIdx >= 0 ? lines.slice(sepIdx + 1).join('\n').trim() : text;
    return { winner, score, confidence, analysis };
  };

  const predict = async () => {
    if (!teamA || !teamB || isGenerating || !modelId) return;
    setPrediction('');
    setParsed(null);
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
      await Promise.all([run.final, run.stats]);
      currentRunRef.current = null;
      clearNotification();
      if (mountedRef.current) {
        setElapsed(Math.round((Date.now() - genStart) / 100) / 10);
        setParsed(parsePrediction(streamed));
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

  // Team picker screen
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
                    style={[styles.teamRow, { borderColor: theme.border, opacity: isOther ? 0.3 : 1 }]}
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
                    {(selecting === 'A' ? teamA : teamB) === team && (
                      <View style={[styles.teamRowCheck, { backgroundColor: accent }]} />
                    )}
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
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: theme.border }]}>
        <View style={[styles.headerIcon, { backgroundColor: accent + '22' }]}>
          <IconTarget size={14} color={accent} />
        </View>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Predictor</Text>
        {modelId && <View style={[styles.liveDot, { backgroundColor: accent }]} />}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Model loading pulse */}
        {modelLoading && !noModel && (
          <Animated.View style={[styles.loadingBar, { backgroundColor: theme.card, borderColor: theme.border, opacity: loadPulse }]}>
            <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Warming up model...</Text>
          </Animated.View>
        )}

        {/* Team picker */}
        <View style={styles.matchup}>
          <TouchableOpacity
            style={[styles.teamCard, { backgroundColor: theme.card, borderColor: teamA ? accent : theme.border }]}
            onPress={() => setSelecting('A')}
          >
            <Text style={[styles.teamCardLabel, { color: theme.textSecondary }]}>Home</Text>
            <Text style={[styles.teamCardName, { color: teamA ? theme.text : theme.textSecondary }]} numberOfLines={2}>
              {teamA ?? 'Pick team'}
            </Text>
          </TouchableOpacity>

          <View style={[styles.vsBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.vsText, { color: theme.textSecondary }]}>VS</Text>
          </View>

          <TouchableOpacity
            style={[styles.teamCard, { backgroundColor: theme.card, borderColor: teamB ? accent : theme.border }]}
            onPress={() => setSelecting('B')}
          >
            <Text style={[styles.teamCardLabel, { color: theme.textSecondary }]}>Away</Text>
            <Text style={[styles.teamCardName, { color: teamB ? theme.text : theme.textSecondary }]} numberOfLines={2}>
              {teamB ?? 'Pick team'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Predict / Stop button */}
        <Animated.View style={{ opacity: pulsAnim }}>
          <TouchableOpacity
            style={[styles.predictBtn, {
              backgroundColor: isGenerating ? theme.error : accent,
              opacity: (teamA && teamB && modelId) || isGenerating ? 1 : 0.38,
            }]}
            onPress={isGenerating ? stopPrediction : predict}
            disabled={!isGenerating && (!teamA || !teamB || !modelId)}
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

        {/* Streaming result (plain) */}
        {isGenerating && prediction.length > 0 && (
          <View style={[styles.resultCard, { backgroundColor: theme.card, borderColor: accent + '50' }]}>
            <View style={[styles.resultBar, { backgroundColor: accent }]} />
            <View style={styles.resultContent}>
              <Text style={[styles.resultLabel, { color: accent }]}>PREDICTING...</Text>
              <Text style={[styles.resultText, { color: theme.text }]}>{prediction}</Text>
            </View>
          </View>
        )}

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

            {/* Analysis */}
            {parsed.analysis ? (
              <View style={[styles.analysisCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={[styles.resultBar, { backgroundColor: accent }]} />
                <View style={styles.resultContent}>
                  <Text style={[styles.resultLabel, { color: accent }]}>ANALYSIS</Text>
                  <Text style={[styles.resultText, { color: theme.text }]}>{parsed.analysis}</Text>
                  {elapsed && (
                    <Text style={[styles.stat, { color: theme.textSecondary }]}>{elapsed}s · on-device</Text>
                  )}
                </View>
              </View>
            ) : null}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  headerIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  content: { padding: 16, gap: 16 },
  loadingBar: {
    borderRadius: 10, borderWidth: 1, padding: 12, alignItems: 'center',
  },
  loadingText: { fontSize: 13, fontWeight: '500' },
  matchup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamCard: {
    flex: 1, borderRadius: 14, borderWidth: 1.5, padding: 16,
    alignItems: 'center', gap: 4, minHeight: 80, justifyContent: 'center',
  },
  teamCardLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  teamCardName: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
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
  resultCard: { borderRadius: 14, borderWidth: 1, flexDirection: 'row', overflow: 'hidden' },
  resultBar: { width: 4 },
  resultContent: { flex: 1, padding: 16, gap: 8 },
  resultLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  resultText: { fontSize: 15, lineHeight: 24 },
  stat: { fontSize: 10 },
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
  analysisCard: { borderRadius: 14, borderWidth: 1, flexDirection: 'row', overflow: 'hidden' },
  groupLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase',
    marginTop: 16, marginBottom: 6,
  },
  teamRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1 },
  teamRowText: { flex: 1, fontSize: 15, fontWeight: '500' },
  teamRowCheck: { width: 8, height: 8, borderRadius: 4 },
});
