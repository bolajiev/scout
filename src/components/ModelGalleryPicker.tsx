import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Animated,
  Dimensions, ActivityIndicator,
} from 'react-native';
import { ModelInfo, DownloadedModel } from '../types';

const { height: SH } = Dimensions.get('window');
const SHEET_H = Math.min(SH * 0.62, 420);

export interface ModelGalleryPickerProps {
  visible: boolean;
  moduleLabel: string;
  moduleSubtitle: string;
  allModels: ModelInfo[];
  downloadedModels: DownloadedModel[];
  activeModelId: string | null;
  loadingModelId?: string | null;
  onSelect: (model: DownloadedModel) => void;
  onDownload: (modelId: string) => void;
  onClose: () => void;
  theme: any;
}

export default function ModelGalleryPicker({
  visible, moduleLabel, moduleSubtitle, allModels, downloadedModels,
  activeModelId, loadingModelId, onSelect, onDownload, onClose, theme,
}: ModelGalleryPickerProps) {
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
          <TouchableOpacity
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
            onPress={onClose} activeOpacity={1}
          />
        </Animated.View>

        <Animated.View style={[styles.sheet, { backgroundColor: theme.card, transform: [{ translateY: slideAnim }] }]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />

          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: theme.text }]}>{moduleLabel}</Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{moduleSubtitle}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.closeX, { color: theme.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.rows}>
            {allModels.map(m => {
              const dl = downloadedModels.find(d => d.id === m.id);
              const active = activeModelId === m.id;
              const loading = loadingModelId === m.id;
              return (
                <View
                  key={m.id}
                  style={[
                    styles.row,
                    { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accent + '10' : theme.background },
                  ]}
                >
                  {/* Radio */}
                  <View style={[styles.radio, { borderColor: active ? theme.accent : theme.border }]}>
                    {active && <View style={[styles.radioDot, { backgroundColor: theme.accent }]} />}
                  </View>

                  {/* Info */}
                  <View style={styles.rowBody}>
                    <Text style={[styles.modelName, { color: theme.text }]}>{m.name}</Text>
                    {m.tagline ? (
                      <Text style={[styles.tagline, { color: theme.textSecondary }]}>{m.tagline}</Text>
                    ) : null}
                    <View style={styles.metaRow}>
                      <Text style={[styles.size, { color: theme.textSecondary }]}>{m.size}</Text>
                      {dl && (
                        <View style={[styles.onDeviceBadge, { backgroundColor: theme.accent + '22' }]}>
                          <Text style={[styles.onDeviceText, { color: theme.accent }]}>On Device</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Action */}
                  <View style={styles.rowAction}>
                    {loading ? (
                      <ActivityIndicator size="small" color={theme.accent} />
                    ) : dl ? (
                      <TouchableOpacity
                        style={[
                          styles.useBtn,
                          { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accent : 'transparent' },
                        ]}
                        onPress={() => { onSelect(dl); onClose(); }}
                        disabled={active}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.useBtnText, { color: active ? theme.accentFg : theme.textSecondary }]}>
                          {active ? '✓ Active' : 'Use'}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.getBtn, { backgroundColor: theme.accent }]}
                        onPress={() => { onDownload(m.id); onClose(); }}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.getBtnText, { color: theme.accentFg }]}>Get →</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}

            {allModels.length === 0 && (
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No models available for this module.</Text>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 36, overflow: 'hidden' },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  title: { fontSize: 17, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 2 },
  closeX: { fontSize: 16, fontWeight: '600', paddingTop: 2 },
  rows: { paddingHorizontal: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1.5 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  radioDot: { width: 9, height: 9, borderRadius: 4.5 },
  rowBody: { flex: 1, gap: 2 },
  modelName: { fontSize: 14, fontWeight: '700' },
  tagline: { fontSize: 11, lineHeight: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  size: { fontSize: 11, fontWeight: '500' },
  onDeviceBadge: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  onDeviceText: { fontSize: 10, fontWeight: '700' },
  rowAction: { flexShrink: 0 },
  useBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  useBtnText: { fontSize: 12, fontWeight: '700' },
  getBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  getBtnText: { fontSize: 12, fontWeight: '800' },
  emptyText: { textAlign: 'center', paddingVertical: 20, fontSize: 13 },
});
