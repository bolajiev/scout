import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, FlatList } from 'react-native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { fonts } from '../theme/fonts';
import type { DownloadedModel } from '../types';

// Shown when the user taps "Load Model" and there's more than one
// downloaded model to choose from — previously always auto-picked one
// (loaded model > user default > first text model), silently ignoring
// that a second one existed at all.
export default function ModelPickerModal({
  visible, models, currentModelId, onSelect, onClose,
}: {
  visible: boolean;
  models: DownloadedModel[];
  currentModelId?: string | null;
  onSelect: (model: DownloadedModel) => void;
  onClose: () => void;
}) {
  const theme = getTheme(useTheme());
  const accent = theme.accent;

  // See PhotoSourceSheet.tsx for why these two props matter — without
  // them this modal opens its own native window that doesn't inherit the
  // app's dark edge-to-edge theming.
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]}>Choose a model</Text>
          <FlatList
            data={models}
            keyExtractor={m => m.id}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => {
              const active = item.id === currentModelId;
              return (
                <TouchableOpacity
                  style={[styles.row, { borderColor: theme.border }]}
                  onPress={() => { onSelect(item); onClose(); }}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowName, { color: theme.text }]}>{item.name}</Text>
                    <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                      {item.modelType === 'vision' ? 'Vision' : 'Text'} · {item.size}
                    </Text>
                  </View>
                  {active && <View style={[styles.activeDot, { backgroundColor: accent }]} />}
                </TouchableOpacity>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, padding: 16, paddingBottom: 28 },
  title: { fontSize: 15, fontFamily: fonts.displayExtraBold, marginBottom: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 13, borderTopWidth: 1,
  },
  rowName: { fontSize: 14, fontFamily: fonts.bodySemiBold },
  rowMeta: { fontSize: 11.5, fontFamily: fonts.bodyMedium, marginTop: 2 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
});
