import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { fonts } from '../theme/fonts';
import { IconCalendar, IconTarget, IconBall } from './Icons';

// v3 tab bar: slim pill with Matches/Predict as side tabs and Coach raised
// out of it as a distinct circular volt action in the center. The pill's
// own height — screens pad their scroll content by insets.bottom + 12 +
// this + breathing room so nothing interactive renders under it.
export const TAB_BAR_HEIGHT = 64;

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const theme = getTheme(useTheme());
  const insets = useSafeAreaInsets();

  // Hide while the keyboard is up — the bar would otherwise ride up over
  // whatever input the user is typing into.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (keyboardUp) return null;

  // Coach is a full-screen takeover — the tab bar leaves entirely and the
  // screen's own back button (→ Matches) is the only way out.
  if (state.routes[state.index].name === 'MatchAI') return null;

  const go = (name: string) => {
    const route = state.routes.find(r => r.name === name);
    if (!route) return;
    const focused = state.routes[state.index].name === name;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigation.navigate(name);
  };

  const sideTab = (name: string, label: string, Icon: React.ComponentType<{ size?: number; color?: string }>) => {
    const focused = state.routes[state.index].name === name;
    const color = focused ? theme.accent : theme.textSecondary;
    return (
      <TouchableOpacity style={styles.side} activeOpacity={0.75} onPress={() => go(name)}>
        <Icon size={17} color={color} />
        <Text style={[styles.label, { color }]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 12, backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
      {/* Three equal columns — the ball is laid out in the middle third,
          not absolutely positioned, so it's centered by construction. */}
      <View style={styles.third}>{sideTab('Home', 'Matches', IconCalendar)}</View>
      <View style={styles.third}>
        {/* BUG FIX: was raised out of the bar as a floating circular
            button (marginTop: -22) — now sits flush with Matches/Predict
            like a normal third tab. Coach can never show a "focused" muted
            state the way the other two do (its own screen hides this bar
            entirely), so it stays accent-colored always rather than
            following the focused/unfocused pattern. */}
        <TouchableOpacity style={styles.side} activeOpacity={0.75} onPress={() => go('MatchAI')}>
          <IconBall size={17} color={theme.accent} />
          <Text style={[styles.label, { color: theme.accent }]}>Coach</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.third}>{sideTab('Predictor', 'Predict', IconTarget)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', left: 24, right: 24, maxWidth: 340, alignSelf: 'center',
    height: 52, flexDirection: 'row', alignItems: 'center',
    borderRadius: 24, borderWidth: 1, paddingHorizontal: 10,
  },
  third: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  side: { alignItems: 'center', gap: 2 },
  label: { fontSize: 9, fontFamily: fonts.bodySemiBold },
});
