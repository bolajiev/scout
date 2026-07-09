import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle } from 'react-native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';

// One shared pulse driving every skeleton block on screen — a single
// Animated.loop instead of one per block, so a whole skeleton screen (hero
// + several rows) doesn't spin up a dozen independent animation loops that
// drift out of sync with each other.
function usePulse() {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.85, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return pulse;
}

export function SkeletonBlock({ style, pulse }: { style?: ViewStyle | ViewStyle[]; pulse: Animated.Value }) {
  const theme = getTheme(useTheme());
  return <Animated.View style={[styles.block, { backgroundColor: theme.cardHot, opacity: pulse }, style]} />;
}

// Matches HomeScreen's `hero` card shape (badges + team names either side
// of a center time, eyebrow league label top) so the swap from skeleton to
// real content doesn't jump in size or feel like a different component.
export function SkeletonHeroCard() {
  const theme = getTheme(useTheme());
  const pulse = usePulse();
  return (
    <View style={[skStyles.hero, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={skStyles.heroTop}>
        <SkeletonBlock pulse={pulse} style={{ width: 120, height: 10, borderRadius: 5 }} />
        <SkeletonBlock pulse={pulse} style={{ width: 64, height: 18, borderRadius: 9 }} />
      </View>
      <View style={skStyles.heroTeams}>
        <View style={skStyles.heroTeamCol}>
          <SkeletonBlock pulse={pulse} style={{ width: 52, height: 52, borderRadius: 26 }} />
          <SkeletonBlock pulse={pulse} style={{ width: 70, height: 10, borderRadius: 5, marginTop: 9 }} />
        </View>
        <SkeletonBlock pulse={pulse} style={{ width: 48, height: 30, borderRadius: 6 }} />
        <View style={skStyles.heroTeamCol}>
          <SkeletonBlock pulse={pulse} style={{ width: 52, height: 52, borderRadius: 26 }} />
          <SkeletonBlock pulse={pulse} style={{ width: 70, height: 10, borderRadius: 5, marginTop: 9 }} />
        </View>
      </View>
      <SkeletonBlock pulse={pulse} style={{ width: 160, height: 9, borderRadius: 5, alignSelf: 'center' }} />
    </View>
  );
}

// One row = one fixture card's shape (league label, badge+name left, time
// center, name+badge right) — matches HomeScreen's `fixRow` layout.
function SkeletonFixtureRow({ pulse }: { pulse: Animated.Value }) {
  const theme = getTheme(useTheme());
  return (
    <View style={[skStyles.fixRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <SkeletonBlock pulse={pulse} style={{ width: 90, height: 8, borderRadius: 4 }} />
      <View style={skStyles.fixTeamsRow}>
        <View style={skStyles.fixTeamLeft}>
          <SkeletonBlock pulse={pulse} style={{ width: 28, height: 28, borderRadius: 14 }} />
          <SkeletonBlock pulse={pulse} style={{ width: 70, height: 11, borderRadius: 5 }} />
        </View>
        <SkeletonBlock pulse={pulse} style={{ width: 32, height: 14, borderRadius: 4 }} />
        <View style={skStyles.fixTeamRight}>
          <SkeletonBlock pulse={pulse} style={{ width: 70, height: 11, borderRadius: 5 }} />
          <SkeletonBlock pulse={pulse} style={{ width: 28, height: 28, borderRadius: 14 }} />
        </View>
      </View>
    </View>
  );
}

// Three-row preview — enough to read as "a list is coming" without
// pretending to know how many fixtures will actually load.
export function SkeletonFixtureList() {
  const pulse = usePulse();
  return (
    <View>
      {[0, 1, 2].map(i => <SkeletonFixtureRow key={i} pulse={pulse} />)}
    </View>
  );
}

// Predictor's "analyzing" state — was a plain text block ("ANALYZING THE
// MATCHUP...") floating in an otherwise empty screen. Shaped like the
// verdict card that's about to replace it (badges, VS, headline, 3-way
// odds row) so the reveal reads as content arriving, not a screen swap.
export function SkeletonVerdictCard() {
  const theme = getTheme(useTheme());
  const pulse = usePulse();
  return (
    <View style={[skStyles.verdict, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={skStyles.heroTeams}>
        <View style={skStyles.heroTeamCol}>
          <SkeletonBlock pulse={pulse} style={{ width: 32, height: 32, borderRadius: 16 }} />
        </View>
        <SkeletonBlock pulse={pulse} style={{ width: 24, height: 10, borderRadius: 5 }} />
        <View style={skStyles.heroTeamCol}>
          <SkeletonBlock pulse={pulse} style={{ width: 32, height: 32, borderRadius: 16 }} />
        </View>
      </View>
      <SkeletonBlock pulse={pulse} style={{ width: 70, height: 9, borderRadius: 5, alignSelf: 'center', marginTop: 18 }} />
      <SkeletonBlock pulse={pulse} style={{ width: 200, height: 26, borderRadius: 6, alignSelf: 'center', marginTop: 10 }} />
      <SkeletonBlock pulse={pulse} style={{ width: 140, height: 12, borderRadius: 5, alignSelf: 'center', marginTop: 12 }} />
      <View style={skStyles.oddsRow}>
        <SkeletonBlock pulse={pulse} style={{ flex: 1, height: 52, borderRadius: 14 }} />
        <SkeletonBlock pulse={pulse} style={{ flex: 1, height: 52, borderRadius: 14 }} />
        <SkeletonBlock pulse={pulse} style={{ flex: 1, height: 52, borderRadius: 14 }} />
      </View>
    </View>
  );
}

// Matches MatchDetailScreen's own section shape (label + card, repeated) —
// the hero itself isn't included since it renders instantly from route
// params (badges/names/time need no fetch), only the sections below it
// (form/H2H/lineups) actually wait on a network call.
export function SkeletonMatchDetail() {
  const theme = getTheme(useTheme());
  const pulse = usePulse();
  const Section = ({ labelWidth, rows }: { labelWidth: number; rows: number }) => (
    <View style={{ marginBottom: 20 }}>
      <SkeletonBlock pulse={pulse} style={{ width: labelWidth, height: 10, borderRadius: 5, marginBottom: 8 }} />
      <View style={[skStyles.detailSection, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonBlock key={i} pulse={pulse} style={{ height: 14, borderRadius: 5, marginBottom: i < rows - 1 ? 12 : 0, width: `${75 - i * 14}%` as any }} />
        ))}
      </View>
    </View>
  );
  return (
    <View>
      <Section labelWidth={100} rows={2} />
      <Section labelWidth={120} rows={3} />
      <Section labelWidth={70} rows={4} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { overflow: 'hidden' },
});

const skStyles = StyleSheet.create({
  hero: {
    marginHorizontal: 16, marginTop: 4, borderRadius: 24, padding: 19, gap: 16, borderWidth: 1,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroTeams: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroTeamCol: { flex: 1, alignItems: 'center', gap: 9 },
  fixRow: { marginHorizontal: 16, marginBottom: 8, borderRadius: 16, borderWidth: 1, padding: 12, gap: 12 },
  fixTeamsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  fixTeamLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  fixTeamRight: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'flex-end' },
  verdict: { borderRadius: 24, borderWidth: 1, padding: 20, marginHorizontal: 16 },
  oddsRow: { flexDirection: 'row', gap: 8, marginTop: 20 },
  detailSection: { borderRadius: 16, borderWidth: 1, padding: 14 },
});
