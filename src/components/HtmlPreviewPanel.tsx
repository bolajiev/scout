import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Dimensions,
  StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';

const { height: SH } = Dimensions.get('window');
const PANEL_H = SH * 0.82;

interface Props {
  visible: boolean;
  source: string;
  fileName: string;
  fileUri?: string;
  onClose: () => void;
  theme: any;
}

export default function HtmlPreviewPanel({ visible, source, fileName, fileUri, onClose, theme }: Props) {
  const slideAnim = useRef(new Animated.Value(PANEL_H)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const [copied, setCopied] = React.useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [webKey, setWebKey] = useState(0);
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      setFullscreen(false);
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
        mimeType: 'text/html',
        dialogTitle: 'Share HTML file',
        UTI: 'public.html',
      });
    }
  };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(source);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleReload = () => setWebKey(k => k + 1);

  const panelStyle = fullscreen
    ? [styles.panelFullscreen, { backgroundColor: theme.background }]
    : [styles.panel, { backgroundColor: theme.background, transform: [{ translateY: slideAnim }] }];

  return (
    <Modal
      visible={visible}
      transparent={!fullscreen}
      animationType="none"
      onRequestClose={fullscreen ? () => setFullscreen(false) : onClose}
      statusBarTranslucent
    >
      {fullscreen ? (
        <View style={[styles.fullscreenRoot, { backgroundColor: theme.background }]}>
          <StatusBar hidden />
          <View style={[styles.panelHeader, { borderBottomColor: theme.border }]}>
            <View style={styles.headerRow}>
              <View style={styles.fileInfo}>
                <View style={[styles.fileBadge, { backgroundColor: theme.accent + '22', borderColor: theme.accent + '55' }]}>
                  <Text style={[styles.fileBadgeText, { color: theme.accent }]}>HTML</Text>
                </View>
                <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={1}>{fileName}</Text>
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.cardAlt }]} onPress={handleReload} activeOpacity={0.8}>
                  <Text style={[styles.actionBtnText, { color: theme.text }]}>Reload</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.cardAlt }]} onPress={() => setFullscreen(false)} activeOpacity={0.8}>
                  <Text style={[styles.actionBtnText, { color: theme.text }]}>Exit</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          <WebView
            key={webKey}
            ref={webRef}
            source={{ html: source }}
            style={styles.webview}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess={false}
            mixedContentMode="always"
            allowsInlineMediaPlayback
          />
        </View>
      ) : (
        <View style={styles.root}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropAnim }]}>
            <TouchableOpacity
              style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
              onPress={onClose} activeOpacity={1}
            />
          </Animated.View>

          <Animated.View style={panelStyle}>
            <View style={[styles.panelHeader, { borderBottomColor: theme.border }]}>
              <View style={[styles.handleBar, { backgroundColor: theme.border }]} />
              <View style={styles.headerRow}>
                <View style={styles.fileInfo}>
                  <View style={[styles.fileBadge, { backgroundColor: theme.accent + '22', borderColor: theme.accent + '55' }]}>
                    <Text style={[styles.fileBadgeText, { color: theme.accent }]}>HTML</Text>
                  </View>
                  <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={1}>{fileName}</Text>
                </View>
                <View style={styles.headerActions}>
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.cardAlt }]} onPress={handleReload} activeOpacity={0.8}>
                    <Text style={[styles.actionBtnText, { color: theme.text }]}>Reload</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.cardAlt }]} onPress={() => setFullscreen(true)} activeOpacity={0.8}>
                    <Text style={[styles.actionBtnText, { color: theme.text }]}>Full</Text>
                  </TouchableOpacity>
                  {fileUri && (
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.accent }]} onPress={handleShare} activeOpacity={0.8}>
                      <Text style={[styles.actionBtnText, { color: theme.accentFg }]}>Share</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.cardAlt }]} onPress={handleCopy} activeOpacity={0.8}>
                    <Text style={[styles.actionBtnText, { color: theme.text }]}>{copied ? 'Copied' : 'Copy'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={[styles.closeBtn, { color: theme.textSecondary }]}>x</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <WebView
              key={webKey}
              ref={webRef}
              source={{ html: source }}
              style={styles.webview}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              allowFileAccess={false}
              mixedContentMode="always"
              allowsInlineMediaPlayback
            />
          </Animated.View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  fullscreenRoot: { flex: 1 },
  panel: {
    height: PANEL_H, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 20,
  },
  panelFullscreen: { flex: 1 },
  panelHeader: { paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  handleBar: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  fileInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginRight: 8 },
  fileBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  fileBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  fileName: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  actionBtnText: { fontSize: 12, fontWeight: '700' },
  closeBtn: { fontSize: 16, fontWeight: '600', paddingLeft: 4 },
  webview: { flex: 1 },
});
