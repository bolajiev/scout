import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Animated,
  Dimensions, ScrollView,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';

const { height: SH } = Dimensions.get('window');
const PANEL_H = SH * 0.75;

interface Props {
  visible: boolean;
  source: string;
  fileName: string;
  fileUri?: string;
  onClose: () => void;
  theme: any;
}

export default function MdPreviewPanel({ visible, source, fileName, fileUri, onClose, theme }: Props) {
  const slideAnim = useRef(new Animated.Value(PANEL_H)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const [copied, setCopied] = React.useState(false);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: PANEL_H, duration: 230, useNativeDriver: true }),
        Animated.timing(backdropAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const handleShare = async () => {
    if (!fileUri) return;
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/markdown',
        dialogTitle: 'Share Markdown file',
        UTI: 'net.daringfireball.markdown',
      });
    }
  };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(source);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const mdStyles = {
    body: { color: theme.text, fontSize: 15, lineHeight: 22, padding: 0 } as any,
    heading1: { color: theme.text, fontWeight: '800', fontSize: 22, marginBottom: 8, marginTop: 4 } as any,
    heading2: { color: theme.text, fontWeight: '700', fontSize: 18, marginBottom: 6, marginTop: 12 } as any,
    heading3: { color: theme.text, fontWeight: '600', fontSize: 15, marginBottom: 4, marginTop: 10 } as any,
    paragraph: { color: theme.text, marginBottom: 6 } as any,
    code_block: { backgroundColor: theme.cardAlt, borderRadius: 8, padding: 12, fontFamily: 'monospace', fontSize: 12, color: theme.text } as any,
    code_inline: { backgroundColor: theme.cardAlt, borderRadius: 4, fontFamily: 'monospace', fontSize: 12, color: theme.text } as any,
    fence: { backgroundColor: theme.cardAlt, borderRadius: 8, padding: 12 } as any,
    blockquote: { backgroundColor: theme.cardAlt, borderLeftColor: theme.accent, borderLeftWidth: 3, paddingLeft: 12, marginLeft: 0 } as any,
    bullet_list_icon: { color: theme.accent } as any,
    strong: { fontWeight: '700', color: theme.text } as any,
    em: { fontStyle: 'italic', color: theme.text } as any,
    link: { color: theme.accent } as any,
    table: { borderWidth: 1, borderColor: theme.border, borderRadius: 6, marginVertical: 8, overflow: 'hidden' } as any,
    thead: { backgroundColor: theme.cardAlt } as any,
    tbody: {} as any,
    th: { flex: 1, padding: 8, fontWeight: '700', color: theme.text, borderRightWidth: 1, borderColor: theme.border, fontSize: 13 } as any,
    td: { flex: 1, padding: 8, color: theme.text, borderRightWidth: 1, borderColor: theme.border, fontSize: 13 } as any,
    tr: { flexDirection: 'row', borderBottomWidth: 1, borderColor: theme.border } as any,
    hr: { backgroundColor: theme.border } as any,
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Backdrop */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropAnim }]}>
          <TouchableOpacity
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
            onPress={onClose} activeOpacity={1}
          />
        </Animated.View>

        {/* Panel */}
        <Animated.View style={[styles.panel, { backgroundColor: theme.background, transform: [{ translateY: slideAnim }] }]}>
          {/* Header */}
          <View style={[styles.panelHeader, { borderBottomColor: theme.border }]}>
            <View style={[styles.handleBar, { backgroundColor: theme.border }]} />
            <View style={styles.headerRow}>
              <View style={styles.fileInfo}>
                <View style={[styles.fileBadge, { backgroundColor: theme.accent + '22', borderColor: theme.accent + '55' }]}>
                  <Text style={[styles.fileBadgeText, { color: theme.accent }]}>MD</Text>
                </View>
                <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={1}>{fileName}</Text>
              </View>
              <View style={styles.headerActions}>
                {fileUri && (
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.accent }]} onPress={handleShare} activeOpacity={0.8}>
                    <Text style={[styles.actionBtnText, { color: theme.accentFg }]}>Share ↗</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.cardAlt }]} onPress={handleCopy} activeOpacity={0.8}>
                  <Text style={[styles.actionBtnText, { color: theme.text }]}>{copied ? 'Copied ✓' : 'Copy'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={[styles.closeBtn, { color: theme.textSecondary }]}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Content */}
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Markdown style={mdStyles}>{source}</Markdown>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    height: PANEL_H, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 20,
  },
  panelHeader: { paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  handleBar: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  fileInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginRight: 8 },
  fileBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  fileBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  fileName: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  actionBtnText: { fontSize: 12, fontWeight: '700' },
  closeBtn: { fontSize: 16, fontWeight: '600', paddingLeft: 4 },
  scroll: { flex: 1 },
  scrollContent: { padding: 18, paddingBottom: 40 },
});
