import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { fonts } from '../theme/fonts';
import { IconCamera, IconPhoto } from './Icons';

// Replaces a plain Alert.alert("Add a photo", ...) — a native gray dialog
// with default Android button styling that looked completely out of place
// against the app's own dark theme. Same two choices, themed like the rest
// of the app instead of the OS chrome.
export default function PhotoSourceSheet({
  visible, onCamera, onGallery, onClose,
}: {
  visible: boolean;
  onCamera: () => void;
  onGallery: () => void;
  onClose: () => void;
}) {
  const theme = getTheme(useTheme());
  const insets = useSafeAreaInsets();
  const accent = theme.accent;

  const Row = ({ icon, label, sub, onPress }: { icon: React.ReactNode; label: string; sub: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.iconBox, { backgroundColor: accent + '18' }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.rowSub, { color: theme.textSecondary }]}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.cardAlt, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <Text style={[styles.title, { color: theme.text }]}>Add a photo</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Coach can identify jerseys, badges, and scoreboards
          </Text>
          <Row
            icon={<IconCamera size={19} color={accent} />}
            label="Camera"
            sub="Take a new photo"
            onPress={onCamera}
          />
          <Row
            icon={<IconPhoto size={19} color={accent} />}
            label="Gallery"
            sub="Choose an existing photo"
            onPress={onGallery}
          />
          <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.card }]} onPress={onClose} activeOpacity={0.7}>
            <Text style={[styles.cancelText, { color: theme.text }]}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0,
    paddingHorizontal: 18, paddingTop: 10,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 17, fontFamily: fonts.displayExtraBold, marginBottom: 3 },
  subtitle: { fontSize: 12.5, fontFamily: fonts.bodyMedium, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 11 },
  iconBox: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 15, fontFamily: fonts.bodySemiBold },
  rowSub: { fontSize: 12, fontFamily: fonts.bodyMedium, marginTop: 1 },
  cancelBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  cancelText: { fontSize: 14.5, fontFamily: fonts.bodySemiBold },
});
