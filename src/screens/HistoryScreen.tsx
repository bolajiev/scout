import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, Image,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { getSessions, getMessages, deleteSession, type Session, type Message, type ScreenType } from '../utils/historyDb';
import { parsePrediction } from '../utils/predictionParser';
import ScreenHeader from '../components/ScreenHeader';

// Scout Lens was removed as a feature entirely — any old scan sessions
// from before that removal stay in the database (never destructively
// deleted), but there's no reason to keep giving them their own tab.
const TABS: { key: ScreenType; label: string }[] = [
  { key: 'matchai', label: 'Coach' },
  { key: 'predictor', label: 'Predict' },
];

const fmtDate = (ts: number) => {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

  // BUG FIX: this used to be a single `tab` state seeded once from
  // route.params?.tab and re-synced via a useFocusEffect keyed on that
  // param — but React Navigation reuses an already-mounted 'History'
  // instance (pushed from Coach, then later from Predictor) and the
  // reported symptom (Predictor's history showing while the header still
  // said Coach, or vice versa) points at that re-sync not reliably firing
  // in every navigation path. Reading route.params?.tab directly on every
  // render removes the possibility of the two disagreeing — a local
  // override exists only for the in-screen tab buttons, and gets cleared
  // whenever we're freshly navigated to (with a real tab param).
  const routeTab: ScreenType = route.params?.tab ?? 'matchai';
  const [tabOverride, setTabOverride] = useState<ScreenType | null>(null);
  const tab = tabOverride ?? routeTab;
  const [refreshTick, setRefreshTick] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});

  // BUG FIX: sessions/counts used to be separate state, synced by a
  // useEffect that ran AFTER tab changed — a real gap where `tab` had
  // already updated (e.g. switching to "Lens") but `sessions` still held
  // the previous tab's rows for one render, showing the wrong tab's
  // history under the new tab's header. getSessions() is a synchronous
  // SQLite call, so there's no reason for this to be separate state at
  // all — deriving it directly means it's IMPOSSIBLE for tab and
  // sessions to disagree, by construction, not by timing luck.
  const sessions = useMemo(() => {
    try { return getSessions(tab); } catch { return []; }
  }, [tab, refreshTick]);

  const counts = useMemo((): Record<ScreenType, number> => {
    try {
      return {
        matchai: getSessions('matchai').length,
        predictor: getSessions('predictor').length,
        scoutlens: getSessions('scoutlens').length,
      };
    } catch { return { matchai: 0, predictor: 0, scoutlens: 0 }; }
  }, [refreshTick]);

  // Every fresh navigation into History (a real tab param arriving) drops
  // any leftover in-screen tab-button override, so the tab always starts
  // matching whichever screen's "History" link was actually tapped.
  useFocusEffect(
    useCallback(() => {
      setTabOverride(null);
      setExpanded(null);
      setRefreshTick(t => t + 1);
    }, [route.params?.tab])
  );

  const switchTab = (t: ScreenType) => {
    setTabOverride(t);
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
          // BUG FIX: the UI used to update unconditionally regardless of
          // whether the delete actually succeeded — a failed delete meant
          // the session vanished from THIS screen but was still in
          // SQLite, silently reappearing the next time getSessions() ran
          // (tab switch, app restart) with no indication anything had
          // gone wrong.
          try {
            deleteSession(sessionId);
          } catch (e) {
            Alert.alert('Could not delete', 'Something went wrong — please try again.');
            return;
          }
          setRefreshTick(t => t + 1);
          setMessages(prev => { const n = { ...prev }; delete n[sessionId]; return n; });
          if (expanded === sessionId) setExpanded(null);
        },
      },
    ]);
  };

  // ── Per-type expanded content ─────────────────────────────────────────────
  // Chat sessions no longer expand in place at all — tapping one jumps
  // straight into live AI Coach (see renderSession). Predictor sessions
  // used to expand in place here too (an accordion re-deriving the same
  // card PredictionResultScreen already renders) — now they navigate
  // straight to that actual result page instead, same as Chat does, via
  // openPrediction below. Lens/scan sessions still preview in place since
  // there's no dedicated result screen to jump into.

  // BUG FIX: tapping a saved prediction used to expand an in-place
  // accordion re-deriving a smaller copy of the result card, instead of
  // just opening the real PredictionResult page the fresh call itself
  // used. Parses the saved text with the same shared parser and hands it
  // to that screen directly — one card implementation, not two.
  const openPrediction = (session: Session) => {
    let msgs = messages[session.id];
    if (!msgs) {
      try { msgs = getMessages(session.id); } catch { msgs = []; }
    }
    const assistantMsg = msgs.find(m => m.role === 'assistant');
    const p = parsePrediction(assistantMsg?.content ?? '');
    const [teamA, teamB] = session.title.split(' vs ');
    navigation.navigate('PredictionResult', {
      teamA: (teamA ?? '').trim(), teamB: (teamB ?? '').trim(),
      winner: p.winner, score: p.score, confidence: p.confidence,
      homeWin: p.homeWin, draw: p.draw, awayWin: p.awayWin,
      analysis: p.analysis,
      elapsed: assistantMsg?.meta?.elapsed,
    });
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
    // Chat sessions skip the preview entirely — tap goes straight into
    // live AI Coach with the conversation restored. Predictor sessions now
    // do the same, jumping straight to the real PredictionResult page (see
    // openPrediction) instead of expanding a duplicate card in place. Only
    // Lens/scan sessions still preview in place, since there's no
    // dedicated result screen for those to jump into.
    const isChat = session.screen === 'matchai';
    const isPrediction = session.screen === 'predictor';
    const isOpen = !isChat && !isPrediction && expanded === session.id;
    const msgs = messages[session.id] ?? [];
    const onRowPress = () => {
      if (isChat) navigation.navigate('MainTabs', { screen: 'MatchAI', params: { resumeSessionId: session.id } });
      else if (isPrediction) openPrediction(session);
      else expand(session.id);
    };
    return (
      <View key={session.id} style={[styles.sessionCard, { backgroundColor: theme.card }, isOpen ? { borderWidth: 1, borderColor: accent + '50' } : null]}>
        <TouchableOpacity
          style={styles.sessionRow}
          onPress={onRowPress}
          activeOpacity={0.75}
        >
          <View style={styles.sessionLeft}>
            <Text style={[styles.sessionTitle, { color: theme.text }]} numberOfLines={1}>{session.title.trim() || 'Untitled session'}</Text>
            <Text style={[styles.sessionDate, { color: theme.textSecondary }]}>{fmtDate(session.createdAt)}</Text>
          </View>
          <View style={styles.sessionRight}>
            <TouchableOpacity
              onPress={() => confirmDelete(session.id, session.title)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.deleteBtn, { color: theme.error }]}>Delete</Text>
            </TouchableOpacity>
            <Text style={[styles.chevron, { color: theme.textSecondary }]}>{(isChat || isPrediction) ? '›' : isOpen ? '‹' : '›'}</Text>
          </View>
        </TouchableOpacity>

        {isOpen && renderScan(msgs)}
      </View>
    );
  };

  const emptyHint =
    tab === 'matchai' ? 'Ask the AI Coach a question to start a session.'
    : tab === 'predictor' ? 'Run a match prediction to save it here.'
    : 'Scan an image to save the result here.';

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="History" />

      {/* Segmented tabs — each feature has its own history */}
      <View style={[styles.segmentWrap, { backgroundColor: theme.card }]}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.segment, active && { backgroundColor: theme.cardAlt }]}
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

  list: { flexGrow: 1, padding: 16, gap: 10 },

  // Empty state
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 260 },

  // Session card
  sessionCard: { borderRadius: 16, overflow: 'hidden' },
  sessionRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  sessionLeft: { flex: 1, gap: 3 },
  sessionTitle: { fontSize: 14, fontWeight: '700' },
  sessionDate: { fontSize: 11 },
  sessionRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  chevron: { fontSize: 16, fontWeight: '700' },
  deleteBtn: { fontSize: 11, fontWeight: '600' },

  msgList: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8 },

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
  oddsRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 8 },
  oddsChip: { fontSize: 11, fontWeight: '700', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  predAnalysis: { fontSize: 13, lineHeight: 20 },
  predKeySection: { gap: 3, marginTop: 4 },
  predKeyLabel: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1 },
  predKeyLine: { fontSize: 12.5, lineHeight: 18 },
  predContext: { fontSize: 11, lineHeight: 16, fontStyle: 'italic' },

  // Scan replay — thumbnail + identification
  scanRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  scanThumb: { width: 64, height: 64, borderRadius: 10 },
  scanResultCol: { flex: 1, gap: 4 },
  scanLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  scanResult: { fontSize: 13, lineHeight: 20 },
});
