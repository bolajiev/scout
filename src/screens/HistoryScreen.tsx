import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, Image,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { getSessions, getMessages, deleteSession, type Session, type Message, type ScreenType } from '../utils/historyDb';

const TABS: { key: ScreenType; label: string }[] = [
  { key: 'matchai', label: 'Coach' },
  { key: 'predictor', label: 'Predict' },
  { key: 'scoutlens', label: 'Lens' },
];

const fmtDate = (ts: number) => {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Parse the Predictor's structured output back into scoreboard fields
const parsePrediction = (text: string) => {
  const lines = text.split('\n').map(l => l.trim());
  const winner = lines.find(l => l.startsWith('WINNER:'))?.replace('WINNER:', '').trim() ?? '';
  const score = lines.find(l => l.startsWith('SCORE:'))?.replace('SCORE:', '').trim() ?? '';
  const confidence = lines.find(l => l.startsWith('CONFIDENCE:'))?.replace('CONFIDENCE:', '').trim() ?? '';
  const sepIdx = lines.indexOf('---');
  const analysis = sepIdx >= 0 ? lines.slice(sepIdx + 1).join('\n').trim() : '';
  return { winner, score, confidence, analysis };
};

const imageUriFromMsg = (content: string): string | null =>
  content.startsWith('[image] ') ? content.slice(8) : null;

export default function HistoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();
  const accent = theme.accent;

  const [tab, setTab] = useState<ScreenType>(route.params?.screen ?? 'matchai');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [counts, setCounts] = useState<Record<ScreenType, number>>({ matchai: 0, predictor: 0, scoutlens: 0 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});

  const load = useCallback(() => {
    try {
      setSessions(getSessions(tab));
      setCounts({
        matchai: getSessions('matchai').length,
        predictor: getSessions('predictor').length,
        scoutlens: getSessions('scoutlens').length,
      });
    } catch {}
  }, [tab]);

  useFocusEffect(load);
  useEffect(load, [tab]);

  const switchTab = (t: ScreenType) => {
    setTab(t);
    setExpanded(null);
  };

  const expand = (sessionId: string) => {
    if (expanded === sessionId) { setExpanded(null); return; }
    if (!messages[sessionId]) {
      try {
        setMessages(prev => ({ ...prev, [sessionId]: getMessages(sessionId) }));
      } catch {}
    }
    setExpanded(sessionId);
  };

  const confirmDelete = (sessionId: string, title: string) => {
    Alert.alert('Delete session', `Delete "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          try { deleteSession(sessionId); } catch {}
          setSessions(prev => prev.filter(s => s.id !== sessionId));
          setCounts(prev => ({ ...prev, [tab]: Math.max(0, prev[tab] - 1) }));
          setMessages(prev => { const n = { ...prev }; delete n[sessionId]; return n; });
          if (expanded === sessionId) setExpanded(null);
        },
      },
    ]);
  };

  // ── Per-type expanded content ─────────────────────────────────────────────

  const renderChatMessages = (msgs: Message[]) => (
    <View style={[styles.msgList, { borderTopColor: theme.border }]}>
      {msgs.map(msg => (
        <View key={msg.id} style={msg.role === 'user' ? styles.chatUserRow : styles.chatAiRow}>
          <View style={[
            styles.chatBubble,
            msg.role === 'user'
              ? { backgroundColor: accent, borderBottomRightRadius: 5 }
              : { backgroundColor: theme.cardAlt, borderBottomLeftRadius: 5 },
          ]}>
            <Text style={[styles.chatText, { color: msg.role === 'user' ? '#fff' : theme.text }]}>
              {msg.content}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderPrediction = (session: Session, msgs: Message[]) => {
    const answer = msgs.find(m => m.role === 'assistant')?.content ?? '';
    const userMsg = msgs.find(m => m.role === 'user')?.content ?? '';
    const p = parsePrediction(answer);
    const [teamA, teamB] = session.title.split(' vs ');
    return (
      <View style={[styles.msgList, { borderTopColor: theme.border }]}>
        <View style={[styles.predBoard, { backgroundColor: theme.cardAlt }]}>
          <View style={styles.predTeams}>
            <View style={styles.predTeamCol}>
              <Text style={[styles.predTeamName, { color: theme.text }]} numberOfLines={2}>{teamA ?? '?'}</Text>
              {p.winner && teamA && p.winner.toLowerCase().includes(teamA.trim().toLowerCase()) && (
                <View style={[styles.winTag, { backgroundColor: accent }]}><Text style={styles.winTagText}>WIN</Text></View>
              )}
            </View>
            <Text style={[styles.predScore, { color: theme.text }]}>{p.score || 'vs'}</Text>
            <View style={[styles.predTeamCol, styles.predTeamColRight]}>
              <Text style={[styles.predTeamName, { color: theme.text }]} numberOfLines={2}>{teamB ?? '?'}</Text>
              {p.winner && teamB && p.winner.toLowerCase().includes(teamB.trim().toLowerCase()) && (
                <View style={[styles.winTag, { backgroundColor: accent }]}><Text style={styles.winTagText}>WIN</Text></View>
              )}
            </View>
          </View>
          {p.confidence ? (
            <Text style={[styles.predConf, { color: p.confidence === 'High' ? accent : theme.textSecondary }]}>
              {p.confidence} confidence
            </Text>
          ) : null}
        </View>
        {p.analysis ? (
          <Text style={[styles.predAnalysis, { color: theme.text }]}>{p.analysis}</Text>
        ) : answer ? (
          <Text style={[styles.predAnalysis, { color: theme.text }]}>{answer}</Text>
        ) : null}
        {userMsg.includes('Context:') && (
          <Text style={[styles.predContext, { color: theme.textSecondary }]} numberOfLines={3}>
            {userMsg.slice(userMsg.indexOf('Context:'))}
          </Text>
        )}
      </View>
    );
  };

  const renderScan = (msgs: Message[]) => {
    const uri = imageUriFromMsg(msgs.find(m => m.role === 'user')?.content ?? '');
    const result = msgs.find(m => m.role === 'assistant')?.content ?? '';
    return (
      <View style={[styles.msgList, { borderTopColor: theme.border }]}>
        <View style={styles.scanRow}>
          {uri && (
            <Image source={{ uri }} style={[styles.scanThumb, { backgroundColor: theme.cardAlt }]} resizeMode="cover" />
          )}
          <View style={styles.scanResultCol}>
            <Text style={[styles.scanLabel, { color: accent }]}>IDENTIFIED</Text>
            <Text style={[styles.scanResult, { color: theme.text }]}>{result || 'No result saved.'}</Text>
          </View>
        </View>
      </View>
    );
  };

  // ── Session card ──────────────────────────────────────────────────────────

  const renderSession = (session: Session) => {
    const isOpen = expanded === session.id;
    const msgs = messages[session.id] ?? [];
    return (
      <View key={session.id} style={[styles.sessionCard, { backgroundColor: theme.card, borderColor: isOpen ? accent + '50' : theme.border }]}>
        <TouchableOpacity style={styles.sessionRow} onPress={() => expand(session.id)} activeOpacity={0.75}>
          <View style={styles.sessionLeft}>
            <Text style={[styles.sessionTitle, { color: theme.text }]} numberOfLines={1}>{session.title}</Text>
            <Text style={[styles.sessionDate, { color: theme.textSecondary }]}>{fmtDate(session.createdAt)}</Text>
          </View>
          <View style={styles.sessionRight}>
            <TouchableOpacity
              onPress={() => confirmDelete(session.id, session.title)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.deleteBtn, { color: theme.error }]}>Delete</Text>
            </TouchableOpacity>
            <Text style={[styles.chevron, { color: theme.textSecondary }]}>{isOpen ? '‹' : '›'}</Text>
          </View>
        </TouchableOpacity>

        {isOpen && (
          tab === 'predictor' ? renderPrediction(session, msgs)
          : tab === 'scoutlens' ? renderScan(msgs)
          : renderChatMessages(msgs)
        )}
      </View>
    );
  };

  const emptyHint =
    tab === 'matchai' ? 'Ask the AI Coach a question to start a session.'
    : tab === 'predictor' ? 'Run a match prediction to save it here.'
    : 'Scan an image to save the result here.';

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[styles.backBtn, { color: accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>History</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Segmented tabs — each feature has its own history */}
      <View style={[styles.segmentWrap, { backgroundColor: theme.card }]}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.segment, active && { backgroundColor: theme.cardAlt, borderColor: accent + '55', borderWidth: 1 }]}
              onPress={() => switchTab(t.key)}
              activeOpacity={0.75}
            >
              <Text style={[styles.segmentText, { color: active ? accent : theme.textSecondary }]}>
                {t.label}
              </Text>
              {counts[t.key] > 0 && (
                <Text style={[styles.segmentCount, { color: active ? accent : theme.textSecondary }]}>
                  {counts[t.key]}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        {sessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No history yet</Text>
            <Text style={[styles.emptySub, { color: theme.textSecondary }]}>{emptyHint}</Text>
          </View>
        ) : (
          sessions.map(renderSession)
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { fontSize: 17, fontWeight: '600', marginBottom: 2 },
  headerTitle: { fontSize: 18, fontWeight: '800' },

  // Segmented tabs
  segmentWrap: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 12,
    borderRadius: 12, padding: 4, gap: 4,
  },
  segment: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 9, paddingVertical: 8,
  },
  segmentText: { fontSize: 13, fontWeight: '700' },
  segmentCount: { fontSize: 11, fontWeight: '700', opacity: 0.7 },

  list: { padding: 16, gap: 10 },

  // Empty state
  empty: { alignItems: 'center', marginTop: 80, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 260 },

  // Session card
  sessionCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  sessionRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  sessionLeft: { flex: 1, gap: 3 },
  sessionTitle: { fontSize: 14, fontWeight: '700' },
  sessionDate: { fontSize: 11 },
  sessionRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  chevron: { fontSize: 16, fontWeight: '700' },
  deleteBtn: { fontSize: 11, fontWeight: '600' },

  msgList: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8 },

  // Chat replay — mirrors the live chat bubbles
  chatUserRow: { alignItems: 'flex-end' },
  chatAiRow: { alignItems: 'flex-start' },
  chatBubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
  chatText: { fontSize: 14, lineHeight: 20 },

  // Prediction replay — mini scoreboard
  predBoard: { borderRadius: 12, padding: 14, gap: 10 },
  predTeams: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  predTeamCol: { flex: 1, gap: 5, alignItems: 'flex-start' },
  predTeamColRight: { alignItems: 'flex-end' },
  predTeamName: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  predScore: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5, minWidth: 54, textAlign: 'center' },
  winTag: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  winTagText: { fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  predConf: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  predAnalysis: { fontSize: 13, lineHeight: 20 },
  predContext: { fontSize: 11, lineHeight: 16, fontStyle: 'italic' },

  // Scan replay — thumbnail + identification
  scanRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  scanThumb: { width: 64, height: 64, borderRadius: 10 },
  scanResultCol: { flex: 1, gap: 4 },
  scanLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  scanResult: { fontSize: 13, lineHeight: 20 },
});
