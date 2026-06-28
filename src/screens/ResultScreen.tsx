import React, { useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, Animated,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { saveLensScan } from '../utils/storage';
import ResultActions from '../components/ResultActions';

interface RouteParams {
  text: string;
  query: string;
  imagePath?: string;
  inferenceMs?: number;
  tokensPerSec?: number;
  modelName?: string;
  error?: string;
}

export default function ResultScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const params = route.params as RouteParams;
  const themeMode = useTheme();
  const theme = getTheme(themeMode);

  const slideY = useRef(new Animated.Value(30)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const imageScale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideY, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.spring(imageScale, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start();
    if (params.text && !params.error) {
      saveLensScan({
        id: Date.now().toString(),
        imagePath: params.imagePath,
        query: params.query || 'What is this?',
        text: params.text,
        modelName: params.modelName,
        inferenceMs: params.inferenceMs,
        createdAt: new Date().toISOString(),
      });
    }
  }, []);

  const continueInChat = () => {
    navigation.navigate('ScribeChat', {
      mode: 'chat',
      seedQuery: params.query ? `Re: "${params.query}"` : undefined,
      seedAnswer: params.text,
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Back */}
      <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[styles.backText, { color: theme.accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: theme.text }]}>Result</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Error state */}
        {params.error ? (
          <Animated.View style={[styles.errorCard, { backgroundColor: theme.card, borderColor: theme.border, opacity: fade }]}>
            <Text style={[styles.errorTitle, { color: theme.text }]}>Something went wrong</Text>
            <Text style={[styles.errorMsg, { color: theme.textSecondary }]}>{params.error}</Text>
            <TouchableOpacity
              style={[styles.continueBtn, { backgroundColor: theme.accent, marginTop: 20 }]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.85}
            >
              <Text style={[styles.continueBtnText, { color: theme.accentFg }]}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.newScanBtn, { borderColor: theme.border }]}
              onPress={() => navigation.navigate('Models')}
              activeOpacity={0.7}
            >
              <Text style={[styles.newScanText, { color: theme.textSecondary }]}>Manage Models</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <>
            {/* Image */}
            {params.imagePath && (
              <Animated.View style={[styles.imageWrap, { transform: [{ scale: imageScale }], opacity: fade }]}>
                <Image source={{ uri: params.imagePath }} style={styles.image} resizeMode="cover" />
                <View style={[styles.imageOverlay, { backgroundColor: theme.background + 'CC' }]} />
              </Animated.View>
            )}

            <Animated.View style={{ opacity: fade, transform: [{ translateY: slideY }] }}>
              {/* User question bubble */}
              <View style={styles.questionWrap}>
                <View style={[styles.questionBubble, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.questionText, { color: theme.accentFg }]}>
                    {params.query || 'What is this?'}
                  </Text>
                </View>
              </View>

              {/* AI answer card */}
              <View style={[styles.answerCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={styles.answerHeader}>
                  <View style={[styles.peekDot, { backgroundColor: theme.accent }]} />
                  <Text style={[styles.answerFrom, { color: theme.textSecondary }]}>Peek</Text>
                </View>
                <Text selectable style={[styles.answerText, { color: theme.text }]}>
                  {params.text || 'No result.'}
                </Text>
              </View>

              {/* Stats row */}
              {(params.inferenceMs || params.tokensPerSec || params.modelName) && (
                <View style={styles.statsRow}>
                  {params.modelName && (
                    <View style={[styles.statChip, { backgroundColor: theme.cardAlt }]}>
                      <Text style={[styles.statText, { color: theme.textSecondary }]}>{params.modelName}</Text>
                    </View>
                  )}
                  {params.inferenceMs && (
                    <View style={[styles.statChip, { backgroundColor: theme.cardAlt }]}>
                      <Text style={[styles.statText, { color: theme.textSecondary }]}>
                        {(params.inferenceMs / 1000).toFixed(1)}s
                      </Text>
                    </View>
                  )}
                  {params.tokensPerSec && (
                    <View style={[styles.statChip, { backgroundColor: theme.cardAlt }]}>
                      <Text style={[styles.statText, { color: theme.textSecondary }]}>
                        {params.tokensPerSec.toFixed(0)} tok/s
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Result actions */}
              {params.text && (
                <ResultActions text={params.text} title={`peek-lens-${Date.now()}`} theme={theme} />
              )}

              {/* Continue in Chat */}
              <TouchableOpacity
                style={[styles.continueBtn, { backgroundColor: theme.accent, marginTop: 16 }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); continueInChat(); }}
                activeOpacity={0.85}
              >
                <Text style={[styles.continueBtnText, { color: theme.accentFg }]}>Continue in Chat</Text>
              </TouchableOpacity>

              {/* New scan */}
              <TouchableOpacity
                style={[styles.newScanBtn, { borderColor: theme.border }]}
                onPress={() => navigation.goBack()}
                activeOpacity={0.7}
              >
                <Text style={[styles.newScanText, { color: theme.textSecondary }]}>Scan Again</Text>
              </TouchableOpacity>
            </Animated.View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 58, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 17, fontWeight: '600' },
  topTitle: { fontSize: 16, fontWeight: '800' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, gap: 16, paddingBottom: 48 },
  imageWrap: { borderRadius: 16, overflow: 'hidden', height: 200, marginBottom: 4 },
  image: { width: '100%', height: '100%' },
  imageOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 16 },
  questionWrap: { alignItems: 'flex-end' },
  questionBubble: {
    borderRadius: 20, borderBottomRightRadius: 4,
    paddingHorizontal: 16, paddingVertical: 12, maxWidth: '85%',
  },
  questionText: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  answerCard: {
    borderRadius: 20, borderBottomLeftRadius: 4,
    borderWidth: 1, padding: 18, gap: 10,
  },
  answerHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  peekDot: { width: 7, height: 7, borderRadius: 3.5 },
  answerFrom: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  answerText: { fontSize: 15, lineHeight: 24 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statChip: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  statText: { fontSize: 12, fontWeight: '500' },
  continueBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  continueBtnText: { fontSize: 16, fontWeight: '800' },
  newScanBtn: { borderRadius: 16, paddingVertical: 14, alignItems: 'center', borderWidth: 1 },
  newScanText: { fontSize: 15, fontWeight: '600' },
  errorCard: { borderRadius: 20, borderWidth: 1, padding: 24, gap: 8, marginTop: 40 },
  errorTitle: { fontSize: 20, fontWeight: '700' },
  errorMsg: { fontSize: 14, lineHeight: 20 },
});
