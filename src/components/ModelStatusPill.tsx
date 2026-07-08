import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { fonts } from '../theme/fonts';
import ReportBugLink from './ReportBugLink';

// One small, single-row status control shared by Coach and Predictor —
// replaces the old full-width cards that took a chunk of the page for
// something that's true almost all the time (model ready). Loading/error
// states are transient (appear while something's actually happening, gone
// once resolved); the ready state stays as a small persistent pill so the
// user can always see the model is loaded and has a one-tap way to stop it
// without hunting through a menu.
export default function ModelStatusPill({
  noModel, modelLoading, loadError, modelId, loadPct,
  onLoad, onStop, onGetModel,
}: {
  noModel: boolean;
  modelLoading: boolean;
  loadError: string | null;
  modelId: string | null;
  loadPct: number;
  onLoad: () => void;
  onStop: () => void;
  onGetModel: () => void;
}) {
  const theme = getTheme(useTheme());
  const accent = theme.accent;

  if (noModel) {
    return (
      <TouchableOpacity onPress={onGetModel} style={[styles.pill, { backgroundColor: theme.card, borderColor: theme.border }]} activeOpacity={0.75}>
        <View style={[styles.dot, { backgroundColor: theme.highlight }]} />
        <Text style={[styles.text, { color: theme.text }]}>No model downloaded — tap to get one</Text>
      </TouchableOpacity>
    );
  }
  if (loadError) {
    return (
      <View style={styles.errorWrap}>
        <TouchableOpacity onPress={onLoad} style={[styles.pill, styles.pillInErrorWrap, { backgroundColor: theme.card, borderColor: theme.error + '55' }]} activeOpacity={0.75}>
          <View style={[styles.dot, { backgroundColor: theme.error }]} />
          <Text style={[styles.text, { color: theme.error }]} numberOfLines={1}>Load failed — tap to retry</Text>
        </TouchableOpacity>
        <View style={styles.reportWrap}>
          <ReportBugLink prefill={`Model load failed: ${loadError}`} />
        </View>
      </View>
    );
  }
  if (modelLoading) {
    return (
      <View style={[styles.pill, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={[styles.dot, { backgroundColor: theme.textSecondary }]} />
        <Text style={[styles.text, { color: theme.textSecondary }]}>
          {loadPct > 0 ? `Loading model... ${loadPct}%` : 'Loading model...'}
        </Text>
      </View>
    );
  }
  if (modelId) {
    return (
      <View style={[styles.pill, { backgroundColor: theme.card, borderColor: accent + '35' }]}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={[styles.text, { color: theme.text }]}>Model ready</Text>
        <TouchableOpacity onPress={onStop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.stopText, { color: theme.error }]}>Stop</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <TouchableOpacity onPress={onLoad} style={[styles.pill, { backgroundColor: theme.card, borderColor: theme.border }]} activeOpacity={0.75}>
      <View style={[styles.dot, { backgroundColor: theme.textTertiary }]} />
      <Text style={[styles.text, { color: theme.textSecondary }]}>Model not loaded — tap to load</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1,
    paddingVertical: 6, paddingHorizontal: 12, marginHorizontal: 16, marginBottom: 8,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11.5, fontFamily: fonts.bodySemiBold },
  stopText: { fontSize: 11.5, fontFamily: fonts.bodySemiBold, marginLeft: 4 },
  errorWrap: { marginBottom: 4 },
  pillInErrorWrap: { marginBottom: 2 },
  reportWrap: { marginHorizontal: 16 },
});
