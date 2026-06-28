import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Switch, ScrollView } from 'react-native';
import { getTheme } from '../theme';
import { useTheme, useThemeToggle } from '../navigation/AppNavigator';

interface Props {
  onClose: () => void;
  onNavigate: (screen: string) => void;
}

export default function Sidebar({ onClose, onNavigate }: Props) {
  const themeMode = useTheme();
  const toggle = useThemeToggle();
  const theme = getTheme(themeMode);
  const isDark = themeMode === 'dark';

  return (
    <View style={[styles.container, { backgroundColor: theme.background, borderRightColor: theme.border }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.logoRow}>
          <Image source={require('../../peeklogo.png')} style={styles.logoImg} />
          <Text style={[styles.logoText, { color: theme.text }]}>Peek</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[styles.closeIcon, { color: theme.textSecondary }]}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Menu</Text>
          {[
            { label: 'Model Manager', screen: 'Models' },
            { label: 'Preferences', screen: 'Settings' },
            { label: 'About Peek', screen: 'About' },
          ].map(item => (
            <TouchableOpacity
              key={item.screen}
              style={[styles.navItem, { borderRadius: 10 }]}
              onPress={() => onNavigate(item.screen)}
              activeOpacity={0.7}
            >
              <Text style={[styles.navLabel, { color: theme.text }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Dark mode */}
        <View style={[styles.toggleRow, { borderColor: theme.border }]}>
          <Text style={[styles.toggleLabel, { color: theme.text }]}>Dark mode</Text>
          <Switch
            value={isDark}
            onValueChange={toggle}
            trackColor={{ false: theme.border, true: theme.accent + '80' }}
            thumbColor={isDark ? theme.accent : theme.textSecondary}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Text style={[styles.footerText, { color: theme.textSecondary }]}>Powered by QVAC SDK · On-Device AI</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderRightWidth: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 18, paddingBottom: 16, borderBottomWidth: 1,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoImg: { width: 30, height: 30, borderRadius: 15 },
  logoText: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  closeIcon: { fontSize: 18, fontWeight: '600', padding: 4 },
  scroll: { flex: 1 },
  section: { paddingHorizontal: 10, paddingTop: 18, paddingBottom: 4 },
  sectionLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase', paddingHorizontal: 6, marginBottom: 6 },
  navItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 12 },
  navLabel: { fontSize: 14, fontWeight: '500' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 10, marginTop: 12, paddingHorizontal: 10, paddingVertical: 14,
    borderRadius: 10, borderWidth: 1,
  },
  toggleLabel: { fontSize: 14, fontWeight: '500' },
  footer: { paddingHorizontal: 18, paddingVertical: 18, borderTopWidth: 1 },
  footerText: { fontSize: 11, textAlign: 'center' },
});
