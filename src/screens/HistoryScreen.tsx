import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { getSessions, getMessages, deleteSession, type Session, type Message, type ScreenType } from '../utils/historyDb';

const LABELS: Record<ScreenType, string> = {
  matchai: 'AI Coach',
  predictor: 'Predictor',
  scoutlens: 'Scout Lens',
};

const fmtDate = (ts: number) => {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function HistoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const screen: ScreenType = route.params?.screen ?? 'matchai';
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});

  const load = useCallback(() => {
    setSessions(getSessions(screen));
  }, [screen]);

  useFocusEffect(load);

  const expand = (sessionId: string) => {
    if (expanded === sessionId) {
      setExpanded(null);
      return;
    }
    if (!messages[sessionId]) {
      setMessages(prev => ({ ...prev, [sessionId]: getMessages(sessionId) }));
    }
    setExpanded(sessionId);
  };

  const confirmDelete = (sessionId: string, title: string) => {
    Alert.alert('Delete session', `Delete "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          deleteSession(sessionId);
          setSessions(prev => prev.filter(s => s.id !== sessionId));
          setMessages(prev => { const n = { ...prev }; delete n[sessionId]; return n; });
          if (expanded === sessionId) setExpanded(null);
        },
      },
    ]);
  };

  const accent = theme.accent;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[styles.backBtn, { color: accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerLabel, { color: theme.textSecondary }]}>{LABELS[screen]}</Text>
          <Text style={[styles.headerTitle, { color: theme.text }]}>History</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        {sessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No history yet</Text>
            <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
              {screen === 'matchai' && 'Ask the AI Coach a question to start a session.'}
              {screen === 'predictor' && 'Run a match prediction to save it here.'}
              {screen === 'scoutlens' && 'Scan an image to save the result here.'}
            </Text>
          </View>
        ) : (
          sessions.map(session => {
            const isOpen = expanded === session.id;
            const msgs = messages[session.id] ?? [];
            return (
              <View key={session.id} style={[styles.sessionCard, { backgroundColor: theme.card, borderColor: isOpen ? accent + '60' : theme.border }]}>
                <TouchableOpacity style={styles.sessionRow} onPress={() => expand(session.id)} activeOpacity={0.75}>
                  <View style={styles.sessionLeft}>
                    <Text style={[styles.sessionTitle, { color: theme.text }]} numberOfLines={1}>{session.title}</Text>
                    <Text style={[styles.sessionDate, { color: theme.textSecondary }]}>{fmtDate(session.createdAt)}</Text>
                  </View>
                  <View style={styles.sessionRight}>
                    <Text style={[styles.chevron, { color: theme.textSecondary }]}>{isOpen ? '∧' : '∨'}</Text>
                    <TouchableOpacity
                      onPress={() => confirmDelete(session.id, session.title)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Text style={[styles.deleteBtn, { color: theme.error ?? '#ef4444' }]}>delete</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>

                {isOpen && (
                  <View style={[styles.msgList, { borderTopColor: theme.border }]}>
                    {msgs.map(msg => (
                      <View key={msg.id} style={[
                        styles.msgBubble,
                        msg.role === 'user'
                          ? [styles.msgUser, { backgroundColor: accent + '18' }]
                          : [styles.msgAssistant, { backgroundColor: theme.background }],
                      ]}>
                        <Text style={[styles.msgRole, { color: msg.role === 'user' ? accent : theme.textSecondary }]}>
                          {msg.role === 'user' ? 'YOU' : 'AI'}
                        </Text>
                        <Text style={[styles.msgContent, { color: theme.text }]}>{msg.content}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  backBtn: { fontSize: 17, fontWeight: '600', marginBottom: 2 },
  headerCenter: { alignItems: 'center', gap: 1 },
  headerLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  list: { padding: 16, gap: 10 },

  // Empty state
  empty: { alignItems: 'center', marginTop: 80, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 260 },

  // Session card
  sessionCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  sessionRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  sessionLeft: { flex: 1, gap: 3 },
  sessionTitle: { fontSize: 14, fontWeight: '700' },
  sessionDate: { fontSize: 11 },
  sessionRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  chevron: { fontSize: 13, fontWeight: '700' },
  deleteBtn: { fontSize: 11, fontWeight: '600' },

  // Messages
  msgList: { borderTopWidth: 1, padding: 12, gap: 8 },
  msgBubble: { borderRadius: 10, padding: 10, gap: 4 },
  msgUser: {},
  msgAssistant: {},
  msgRole: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  msgContent: { fontSize: 13, lineHeight: 19 },
});
