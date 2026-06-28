import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Modal, Animated, Dimensions,
} from 'react-native';
import { DownloadedModel } from '../types';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';

const { height: SH } = Dimensions.get('window');
const SHEET_H = SH * 0.62;

interface Props {
  visible: boolean;
  moduleTitle: string;
  moduleIcon?: React.ReactNode;
  models: DownloadedModel[];
  initialModelId?: string | null;
  showSetDefault?: boolean;
  startLabel?: string;
  onStart: (model: DownloadedModel, setDefault: boolean) => void;
  onClose: () => void;
  onGetModels: () => void;
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

export default function ModelPickerSheet({
  visible, moduleTitle, moduleIcon, models, initialModelId,
  showSetDefault, startLabel = 'Start', onStart, onClose, onGetModels,
}: Props) {
  const themeMode = useTheme();
  const theme = getTheme(themeMode);

  const slideAnim = useRef(new Animated.Value(SHEET_H)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [setDefault, setSetDefault] = useState(false);

  useEffect(() => {
    if (visible) {
      const first = initialModelId
        ? models.find(m => m.id === initialModelId)?.id ?? models[0]?.id
        : models[0]?.id;
      setSelectedId(first ?? null);
      setSetDefault(false);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, friction: 9, tension: 80 }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: SHEET_H, duration: 220, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, models, initialModelId]);

  const selected = models.find(m => m.id === selectedId) ?? null;

  const handleStart = () => {
    if (!selected) return;
    onStart(selected, setDefault);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
          <TouchableOpacity style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} activeOpacity={1} />
        </Animated.View>

        <Animated.View style={[styles.sheet, { backgroundColor: theme.card, transform: [{ translateY: slideAnim }] }]}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: theme.border }]} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            {moduleIcon && (
              <View style={[styles.moduleIconBox, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
                {moduleIcon}
              </View>
            )}
            <View style={styles.sheetHeaderText}>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>Select Model</Text>
              <Text style={[styles.sheetSub, { color: theme.textSecondary }]}>{moduleTitle}</Text>
            </View>
          </View>

          {models.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No compatible model</Text>
              <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
                Download a model first to use this feature.
              </Text>
              <TouchableOpacity
                style={[styles.getModelsBtn, { backgroundColor: theme.accent }]}
                onPress={onGetModels}
              >
                <Text style={[styles.getModelsBtnText, { color: theme.accentFg }]}>Get Models</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                {models.map(m => {
                  const sel = m.id === selectedId;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[
                        styles.modelRow,
                        { borderColor: sel ? theme.accent : theme.border, backgroundColor: sel ? theme.accent + '12' : theme.background },
                      ]}
                      onPress={() => setSelectedId(m.id)}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.radio, { borderColor: sel ? theme.accent : theme.border }]}>
                        {sel && <View style={[styles.radioDot, { backgroundColor: theme.accent }]} />}
                      </View>
                      <View style={styles.modelInfo}>
                        <View style={styles.modelNameRow}>
                          <Text style={[styles.modelName, { color: theme.text }]}>{m.name}</Text>
                          {m.badge && (
                            <View style={[styles.badge, { backgroundColor: m.badgeColor || theme.accent }]}>
                              <Text style={[styles.badgeText, { color: (m.badgeColor || theme.accent) === theme.accent ? theme.accentFg : '#fff' }]}>{m.badge}</Text>
                            </View>
                          )}
                        </View>
                        {m.description ? (
                          <Text style={[styles.modelDesc, { color: theme.textSecondary }]} numberOfLines={2}>
                            {m.description}
                          </Text>
                        ) : null}
                        <Text style={[styles.modelSize, { color: theme.textSecondary }]}>
                          {formatSize(m.sizeBytes)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {showSetDefault && (
                <TouchableOpacity
                  style={styles.defaultRow}
                  onPress={() => setSetDefault(v => !v)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, { borderColor: setDefault ? theme.accent : theme.border, backgroundColor: setDefault ? theme.accent : 'transparent' }]}>
                    {setDefault && <Text style={[styles.checkmark, { color: theme.accentFg }]}>✓</Text>}
                  </View>
                  <Text style={[styles.defaultLabel, { color: theme.textSecondary }]}>Set as default for Quick Chat</Text>
                </TouchableOpacity>
              )}

              <View style={[styles.footer, { borderTopColor: theme.border }]}>
                <TouchableOpacity style={[styles.startBtn, { backgroundColor: selected ? theme.accent : theme.border }]} onPress={handleStart} disabled={!selected} activeOpacity={0.85}>
                  <Text style={[styles.startBtnText, { color: selected ? theme.accentFg : theme.textSecondary }]}>{startLabel}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    height: SHEET_H, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  moduleIconBox: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  sheetHeaderText: { flex: 1 },
  sheetTitle: { fontSize: 17, fontWeight: '800' },
  sheetSub: { fontSize: 12, marginTop: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  modelRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1.5,
  },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, justifyContent: 'center', alignItems: 'center', marginTop: 2, flexShrink: 0 },
  radioDot: { width: 9, height: 9, borderRadius: 4.5 },
  modelInfo: { flex: 1, gap: 3 },
  modelNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  modelName: { fontSize: 14, fontWeight: '700' },
  badge: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  modelDesc: { fontSize: 12, lineHeight: 17 },
  modelSize: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '800' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  getModelsBtn: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, marginTop: 4 },
  getModelsBtnText: { fontSize: 15, fontWeight: '800' },
  defaultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 12 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  checkmark: { fontSize: 12, fontWeight: '900' },
  defaultLabel: { fontSize: 13 },
  footer: { paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1 },
  startBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  startBtnText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
});
