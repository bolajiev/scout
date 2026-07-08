import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { fonts } from '../theme/fonts';
import { setFdApiKey, setFdKeyEnabled } from '../utils/storage';

// Shown on Matches whenever no active football-data.org key is set — a
// key unlocks accurate live scores/times for more competitions than the
// free keyless source covers. No on/off toggle here on purpose: a toggle
// is easy to flip and forget, so the only state that matters is "is a key
// saved" — tap Add API, paste it, done, and the nudge is gone for good.
export default function FdKeyNudge({ onSaved }: { onSaved: () => void }) {
  const theme = getTheme(useTheme());
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const done = async () => {
    const key = value.trim();
    if (!key) { setOpen(false); return; }
    setSaving(true);
    try {
      await setFdApiKey(key);
      await setFdKeyEnabled(true);
      onSaved();
    } finally {
      setSaving(false);
      setOpen(false);
      setValue('');
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: theme.card, borderColor: theme.border }]}>
      {!open ? (
        <View style={styles.row}>
          <Text style={[styles.text, { color: theme.textSecondary }]}>
            Get more fixtures & accurate live scores — add a free football-data.org key.
          </Text>
          <TouchableOpacity onPress={() => setOpen(true)} style={[styles.addBtn, { backgroundColor: theme.cardAlt, borderColor: theme.accent + '55' }]}>
            <Text style={[styles.addBtnText, { color: theme.accent }]}>Add API</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { backgroundColor: theme.cardAlt, color: theme.text }]}
              placeholder="Paste your football-data.org key"
              placeholderTextColor={theme.textTertiary}
              value={value}
              onChangeText={setValue}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={done} disabled={saving} style={[styles.doneBtn, { backgroundColor: theme.accent }]}>
              <Text style={[styles.doneBtnText, { color: theme.accentFg }]}>Done</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => Linking.openURL('https://www.football-data.org/client/register')}>
            <Text style={[styles.link, { color: theme.accent }]}>Get a free key →</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16, marginBottom: 10,
    borderRadius: 14, borderWidth: 1, padding: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, fontSize: 12, fontFamily: fonts.bodyMedium, lineHeight: 16 },
  addBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  addBtnText: { fontSize: 12, fontFamily: fonts.bodySemiBold },
  input: { flex: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, fontFamily: fonts.bodyMedium },
  doneBtn: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  doneBtnText: { fontSize: 13, fontFamily: fonts.bodySemiBold },
  link: { fontSize: 11, fontFamily: fonts.bodySemiBold, marginLeft: 2 },
});
