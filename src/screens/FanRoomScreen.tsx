import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconBack, IconSend, IconOffline } from '../components/Icons';

// Pears P2P integration placeholder
// Full Pears/Holepunch runtime will be wired here
// For now: local session chat to validate the UI

interface ChatMsg {
  id: string;
  text: string;
  mine: boolean;
  time: string;
}

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function FanRoomScreen() {
  const navigation = useNavigation<any>();
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [roomKey] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const scrollRef = useRef<ScrollView>(null);

  const sendMsg = () => {
    const text = input.trim();
    if (!text) return;
    setMessages(prev => [...prev, { id: `${Date.now()}`, text, mine: true, time: now() }]);
    setInput('');
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    // TODO: broadcast via Pears hyperswarm
  };

  const accent = theme.accent;
  const blue = '#60a5fa';

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <IconBack size={20} color={blue} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <IconOffline size={14} color={blue} />
          <Text style={[styles.headerTitle, { color: theme.text }]}>Fan Room</Text>
          <View style={[styles.onlineDot, { backgroundColor: blue }]} />
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Room info banner */}
      <View style={[styles.roomBanner, { backgroundColor: blue + '14', borderBottomColor: blue + '30' }]}>
        <Text style={[styles.roomLabel, { color: blue }]}>ROOM KEY</Text>
        <Text style={[styles.roomKey, { color: theme.text }]}>{roomKey}</Text>
        <Text style={[styles.roomNote, { color: theme.textSecondary }]}>
          Share this key with fans nearby — no internet needed
        </Text>
      </View>

      {/* Coming soon notice */}
      <View style={[styles.pearsNotice, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.pearsTitle, { color: blue }]}>Pears P2P</Text>
        <Text style={[styles.pearsText, { color: theme.textSecondary }]}>
          Device-to-device fan chat via Holepunch. No server. Works offline in the stadium.
          Pears runtime integration coming — UI is live.
        </Text>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No messages yet</Text>
            <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
              Share your room key with nearby fans to start chatting
            </Text>
          </View>
        )}
        {messages.map(msg => (
          <View key={msg.id} style={[styles.msgRow, msg.mine ? styles.msgRowMine : styles.msgRowOther]}>
            <View style={[
              styles.bubble,
              msg.mine
                ? [styles.bubbleMine, { backgroundColor: blue }]
                : [styles.bubbleOther, { backgroundColor: theme.card, borderColor: theme.border }],
            ]}>
              <Text style={[styles.bubbleText, { color: msg.mine ? '#fff' : theme.text }]}>{msg.text}</Text>
              <Text style={[styles.bubbleTime, { color: msg.mine ? 'rgba(255,255,255,0.6)' : theme.textSecondary }]}>
                {msg.time}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Input */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.inputBar, {
          backgroundColor: theme.background, borderTopColor: theme.border,
          paddingBottom: insets.bottom + 8,
        }]}>
          <TextInput
            style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
            placeholder="Message the fan room..."
            placeholderTextColor={theme.textSecondary}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={sendMsg}
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: blue, opacity: input.trim() ? 1 : 0.4 }]}
            onPress={sendMsg}
            disabled={!input.trim()}
          >
            <IconSend size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  onlineDot: { width: 6, height: 6, borderRadius: 3 },
  roomBanner: {
    paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, gap: 2,
  },
  roomLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  roomKey: { fontSize: 22, fontWeight: '900', letterSpacing: 2 },
  roomNote: { fontSize: 11 },
  pearsNotice: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 10, borderWidth: 1,
    padding: 14, gap: 6,
  },
  pearsTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  pearsText: { fontSize: 13, lineHeight: 19 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 6 },
  emptyState: { paddingTop: 32, gap: 8, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptySub: { fontSize: 13, textAlign: 'center' },
  msgRow: { flexDirection: 'row' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 16, padding: 10, gap: 2 },
  bubbleMine: { borderBottomRightRadius: 4 },
  bubbleOther: { borderWidth: 1, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTime: { fontSize: 10 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1,
  },
  input: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
