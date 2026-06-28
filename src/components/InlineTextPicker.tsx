import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Dimensions,
} from 'react-native';
import { ModelInfo, DownloadedModel } from '../types';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';

const { height: SH } = Dimensions.get('window');
const SHEET_H = Math.min(SH * 0.5, 340);

interface Props {
  visible: boolean;
  allTextModels: ModelInfo[];      // exactly the 2 text models
  downloadedModels: DownloadedModel[];
  activeModelId: string | null;    // storage model id
  onSelect: (model: DownloadedModel) => void;
  onGetModel: (modelId: string) => void;
  onClose: () => void;
}

export default function InlineTextPicker({
  visible, allTextModels, downloadedModels, activeModelId, onSelect, onGetModel, onClose,
}: Props) {
  const theme = getTheme(useTheme());
  const slideAnim = useRef(new Animated.Value(SHEET_H)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, friction: 10, tension: 90 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: SHEET_H, duration: 200, useNativeDriver: true }),
        Animated.timing(backdropAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropAnim }]}>
          <TouchableOpacity style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} onPress={onClose} activeOpacity={1} />
        </Animated.View>

        <Animated.View style={[styles.sheet, { backgroundColor: theme.card, transform: [{ translateY: slideAnim }] }]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <Text style={[styles.title, { color: theme.text }]}>Text Model</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Shared across Scribe and Deep</Text>

          <View style={styles.rows}>
            {allTextModels.map(m => {
              const dl = downloadedModels.find(d => d.id === m.id);
              const active = activeModelId === m.id;
              return (
                <View
                  key={m.id}
                  style={[
                    styles.row,
                    { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accent + '10' : theme.background },
                  ]}
                >
                  <View style={[styles.radio, { borderColor: active ? theme.accent : theme.border }]}>
                    {active && <View style={[styles.radioDot, { backgroundColor: theme.accent }]} />}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.modelName, { color: theme.text }]}>{m.name}</Text>
                    {m.tagline && (
                      <Text style={[styles.tagline, { color: theme.textSecondary }]}>{m.tagline}</Text>
                    )}
                  </View>
                  <View style={styles.rowAction}>
                    {dl ? (
                      <TouchableOpacity
                        style={[styles.selectBtn, { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accent + '20' : 'transparent' }]}
                        onPress={() => { onSelect(dl); onClose(); }}
                        disabled={active}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.selectBtnText, { color: active ? theme.accent : theme.textSecondary }]}>
                          {active ? 'Active' : 'Use'}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.getBtn, { backgroundColor: theme.accent }]}
                        onPress={() => { onGetModel(m.id); onClose(); }}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.getBtnText, { color: theme.accentFg }]}>Get</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingBottom: 28, overflow: 'hidden',
  },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 14 },
  title: { fontSize: 16, fontWeight: '800', paddingHorizontal: 20 },
  subtitle: { fontSize: 12, paddingHorizontal: 20, marginTop: 2, marginBottom: 16 },
  rows: { paddingHorizontal: 14, gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1.5,
  },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  rowBody: { flex: 1, gap: 2 },
  modelName: { fontSize: 14, fontWeight: '700' },
  tagline: { fontSize: 11, lineHeight: 15 },
  rowAction: { flexShrink: 0 },
  selectBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  selectBtnText: { fontSize: 12, fontWeight: '700' },
  getBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  getBtnText: { fontSize: 12, fontWeight: '800' },
});
