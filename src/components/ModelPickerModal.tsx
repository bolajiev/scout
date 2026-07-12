import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, FlatList } from 'react-native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { fonts } from '../theme/fonts';
import type { ModelInfo } from '../types';

export default function ModelPickerModal({
  visible, models, downloadedIds, currentModelId, onSelect, onGetModel, onClose,
}: {
  visible: boolean;
  models: ModelInfo[];
  downloadedIds: Set<string>;
  currentModelId?: string | null;
  onSelect: (model: ModelInfo) => void;
  onGetModel: () => void;
  onClose: () => void;
}) {
  const theme = getTheme(useTheme());
  const accent = theme.accent;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <Text style={[styles.title, { color: theme.text }]}>Choose a model</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Downloaded models load immediately. Tap Get to download a new one.
          </Text>
          <FlatList
            data={models}
            keyExtractor={m => m.id}
            style={{ maxHeight: 400 }}
            renderItem={({ item }) => {
              const isDownloaded = downloadedIds.has(item.id);
              const active = item.id === currentModelId;
              return (
                <TouchableOpacity
                  style={[styles.row, { borderColor: theme.border }]}
                  onPress={() => { isDownloaded ? onSelect(item) : onGetModel(); }}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowNameRow}>
                      <Text style={[styles.rowName, { color: theme.text }]}>{item.name}</Text>
                      {active && <View style={[styles.activeDot, { backgroundColor: accent }]} />}
                    </View>
                    <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                      {item.modelType === 'vision' ? 'Vision' : 'Text'} · {item.size}
                      {item.badge ? ` · ${item.badge}` : ''}
                    </Text>
                  </View>
                  {isDownloaded ? (
                    <View style={[styles.useBadge, { backgroundColor: accent + '20' }]}>
                      <Text style={[styles.useBadgeText, { color: accent }]}>Use</Text>
                    </View>
                  ) : (
                    <View style={[styles.getBadge, { backgroundColor: accent + '20' }]}>
                      <Text style={[styles.getBadgeText, { color: accent }]}>Get</Text>
                    </View>
                  )}
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
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 15, fontFamily: fonts.displayExtraBold, marginBottom: 4 },
  subtitle: { fontSize: 12, fontFamily: fonts.bodyMedium, lineHeight: 17, marginBottom: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 13, borderTopWidth: 1,
  },
  rowNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { fontSize: 14, fontFamily: fonts.bodySemiBold },
  rowMeta: { fontSize: 11.5, fontFamily: fonts.bodyMedium, marginTop: 2 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  getBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  getBadgeText: { fontSize: 11, fontWeight: '700' },
  useBadge: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 999 },
  useBadgeText: { fontSize: 11, fontWeight: '700' },
});
