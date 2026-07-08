import React from 'react';
import { Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { fonts } from '../theme/fonts';

const ISSUES_URL = 'https://github.com/bolajiev/scout/issues/new';

// One small link, dropped into every error/offline message so a user who
// hits something broken has an immediate way to tell us instead of just
// giving up on the app.
export default function ReportBugLink({ prefill }: { prefill?: string }) {
  const theme = getTheme(useTheme());
  const url = prefill
    ? `${ISSUES_URL}?title=${encodeURIComponent(prefill)}`
    : ISSUES_URL;
  return (
    <TouchableOpacity onPress={() => Linking.openURL(url)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
      <Text style={[styles.text, { color: theme.accent }]}>Report a bug →</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 11.5, fontFamily: fonts.bodySemiBold, marginTop: 4 },
});
