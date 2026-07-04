import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { IconBack } from './Icons';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';

const HIT = { top: 12, bottom: 12, left: 12, right: 12 };

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Inline content immediately after the title — e.g. a live dot or a W/L record chip */
  titleExtra?: React.ReactNode;
  /** Right-aligned content — e.g. a toggle chip and/or a "History" link */
  rightSlot?: React.ReactNode;
  /** Defaults to navigation.goBack(). Pass false to hide the back button entirely. */
  onBack?: (() => void) | false;
}

// One header used across every screen so back-button size/position, title
// type scale, and vertical rhythm are identical everywhere — previously
// each screen hand-rolled its own (different icon sizes, some screens used
// a text "‹ Back" instead of the icon, Models had no header at all).
export default function ScreenHeader({ title, subtitle, titleExtra, rightSlot, onBack }: ScreenHeaderProps) {
  const navigation = useNavigation<any>();
  const theme = getTheme(useTheme());
  const insets = useSafeAreaInsets();
  const showBack = onBack !== false;

  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <View style={styles.left}>
        {showBack && (
          <TouchableOpacity
            onPress={onBack || (() => navigation.goBack())}
            hitSlop={HIT}
            style={styles.backBtn}
          >
            <IconBack size={22} color={theme.text} />
          </TouchableOpacity>
        )}
        <View>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
            {titleExtra}
          </View>
          {subtitle && (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
          )}
        </View>
      </View>
      {rightSlot && <View style={styles.right}>{rightSlot}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  backBtn: { padding: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 14, flexShrink: 0, marginLeft: 8 },
});
