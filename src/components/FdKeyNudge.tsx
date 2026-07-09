import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Linking, Modal, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { fonts } from '../theme/fonts';
import { setFdApiKey, setFdKeyEnabled, setFdNudgeDismissed } from '../utils/storage';

// A one-time-per-app-open modal (Home's mount effect decides `visible`,
// gated on the persisted dismissed flag) — this used to be an inline
// banner on Matches that re-checked and could reappear on every single
// visit to the tab, not just once per app open.
export default function FdKeyNudge({ visible, onSaved, onDismiss }: {
  visible: boolean;
  onSaved: () => void;
  onDismiss: () => void;
}) {
  const theme = getTheme(useTheme());
  const insets = useSafeAreaInsets();
  const accent = theme.accent;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const done = async () => {
    const key = value.trim();
    if (!key) { setOpen(false); onDismiss(); return; }
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

  const dontShowAgain = async () => {
    await setFdNudgeDismissed().catch(() => {});
    onDismiss();
  };

  // BUG FIX: navigationBarTranslucent was dropped — verified in react-
  // native's own ReactModalHostView.kt, it makes this Modal's own native
  // window call enableEdgeToEdge(), which force-resets
  // isNavigationBarContrastEnforced to true for THAT window, bypassing
  // the app-wide theme fix (styles.xml) specifically while this sheet is
  // open. statusBarTranslucent alone still keeps the status bar dark-themed.
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.cardAlt, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <Text style={[styles.title, { color: theme.text }]}>Get more fixtures</Text>
          <Text style={[styles.text, { color: theme.textSecondary }]}>
            Add a free football-data.org key for accurate live scores and more competitions.
          </Text>
          {!open ? (
            <>
              <TouchableOpacity onPress={() => setOpen(true)} style={[styles.addBtn, { backgroundColor: accent }]}>
                <Text style={[styles.addBtnText, { color: theme.accentFg }]}>Add API key</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={dontShowAgain} style={styles.laterBtn}>
                <Text style={[styles.laterText, { color: theme.textSecondary }]}>Don't show this again</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={{ gap: 10 }}>
              <TextInput
                style={[styles.input, { backgroundColor: theme.card, color: theme.text }]}
                placeholder="Paste your football-data.org key"
                placeholderTextColor={theme.textTertiary}
                value={value}
                onChangeText={setValue}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={() => Linking.openURL('https://www.football-data.org/client/register')}>
                <Text style={[styles.link, { color: accent }]}>Get a free key →</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={done} disabled={saving} style={[styles.addBtn, { backgroundColor: accent }]}>
                <Text style={[styles.addBtnText, { color: theme.accentFg }]}>{saving ? 'Saving...' : 'Done'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0,
    paddingHorizontal: 20, paddingTop: 10,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 17, fontFamily: fonts.displayExtraBold, marginBottom: 6 },
  text: { fontSize: 13, fontFamily: fonts.bodyMedium, lineHeight: 19, marginBottom: 18 },
  addBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  addBtnText: { fontSize: 14.5, fontFamily: fonts.bodySemiBold },
  laterBtn: { paddingVertical: 14, alignItems: 'center' },
  laterText: { fontSize: 13, fontFamily: fonts.bodyMedium },
  input: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: fonts.bodyMedium },
  link: { fontSize: 12, fontFamily: fonts.bodySemiBold, marginLeft: 2 },
});
