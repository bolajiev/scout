import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Share, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { readMarkdownFile } from '../utils/fileService';
import MarkdownText from '../components/MarkdownText';
import CopyButton from '../components/CopyButton';

export default function FilePreviewScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const name: string = route.params?.name ?? 'document.md';
  const path: string = route.params?.path ?? '';

  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    readMarkdownFile(path)
      .then(text => { setContent(text); setLoading(false); })
      .catch(e => { setError(e?.message ?? 'Could not read file'); setLoading(false); });
  }, [path]);

  const handleShare = async () => {
    try {
      await Share.share({ title: name, message: content });
    } catch {}
  };

  return (
    <Animated.View style={[styles.root, { backgroundColor: theme.background, opacity: fadeAnim }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[styles.backBtn, { color: theme.text }]}>←</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.fileName, { color: theme.text }]} numberOfLines={1}>{name}</Text>
          <Text style={[styles.fileMeta, { color: theme.textSecondary }]}>Markdown</Text>
        </View>

        <View style={styles.headerActions}>
          {content ? <CopyButton text={content} color={theme.textSecondary} size={14} /> : null}
          {content ? (
            <TouchableOpacity onPress={handleShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.shareBtn, { color: theme.accent }]}>Share</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.centeredPane}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : error ? (
        <View style={styles.centeredPane}>
          <Text style={[styles.errorText, { color: theme.error }]}>{error}</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backBtnFull, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.backBtnFullText, { color: theme.text }]}>Go Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, { backgroundColor: theme.background }]} showsVerticalScrollIndicator={false}>
          <MarkdownText color={theme.text} fontSize={15} lineHeight={24}>
            {content}
          </MarkdownText>
          <View style={{ height: 60 }} />
        </ScrollView>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 58, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, gap: 12,
  },
  backBtn: { fontSize: 24, fontWeight: '300' },
  headerCenter: { flex: 1, gap: 2 },
  fileName: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  fileMeta: { fontSize: 11 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  shareBtn: { fontSize: 13, fontWeight: '600' },
  centeredPane: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },
  backBtnFull: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  backBtnFullText: { fontSize: 14, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20 },
});
