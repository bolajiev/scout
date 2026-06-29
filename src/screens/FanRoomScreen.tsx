import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, Clipboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { IconSend, IconOffline } from '../components/Icons';

const ROOM_KEY_STORAGE = '@scout_room_key';

interface ChatMsg {
  id: string;
  text: string;
  mine: boolean;
  time: string;
}

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function FanRoomScreen() {
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  const [roomKey, setRoomKey] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Persist room key across tab switches
  useEffect(() => {
    AsyncStorage.getItem(ROOM_KEY_STORAGE).then(saved => {
      if (saved) {
        setRoomKey(saved);
      } else {
        const key = Math.random().toString(36).slice(2, 8).toUpperCase();
        setRoomKey(key);
        AsyncStorage.setItem(ROOM_KEY_STORAGE, key);
      }
    });
  }, []);

  const sendMsg = () => {
    const text = input.trim();
    if (!text) return;
    setMessages(prev => [...prev, { id: `${Date.now()}`, text, mine: true, time: now() }]);
    setInput('');
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    // TODO: broadcast via Pears hyperswarm
  };

  const copyKey = () => {
    Clipboard.setString(roomKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const joinRoom = () => {
    const key = joinInput.trim().toUpperCase();
    if (key.length < 4) return;
    setJoinedRoom(key);
    setJoinInput('');
    // TODO: connect via Pears hyperswarm using key
  };

  const blue = '#60a5fa';
  const activeRoom = joinedRoom ?? roomKey;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: theme.border }]}>
        <IconOffline size={14} color={blue} />
        <Text style={[styles.headerTitle, { color: theme.text }]}>Fan Room</Text>
        <View style={[styles.onlineDot, { backgroundColor: blue }]} />
      </View>

      {/* Room key section */}
      <View style={[styles.roomSection, { borderBottomColor: theme.border }]}>
        {/* Your key */}
        <View style={[styles.keyCard, { backgroundColor: blue + '12', borderColor: blue + '30' }]}>
          <View style={styles.keyCardLeft}>
            <Text style={[styles.keyLabel, { color: blue }]}>YOUR ROOM KEY</Text>
            <Text style={[styles.keyValue, { color: theme.text }]}>{roomKey || '------'}</Text>
          </View>
          <TouchableOpacity
            style={[styles.copyBtn, { backgroundColor: blue + '20', borderColor: blue + '40' }]}
            onPress={copyKey}
          >
            <Text style={[styles.copyBtnText, { color: blue }]}>{copied ? 'Copied' : 'Copy'}</Text>
          </TouchableOpacity>
        </View>

        {/* Join a room */}
        <View style={styles.joinRow}>
          <TextInput
            style={[styles.joinInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
            placeholder="Enter room key to join..."
            placeholderTextColor={theme.textSecondary}
            value={joinInput}
            onChangeText={t => setJoinInput(t.toUpperCase())}
            maxLength={8}
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={[styles.joinBtn, { backgroundColor: blue, opacity: joinInput.trim().length >= 4 ? 1 : 0.4 }]}
            onPress={joinRoom}
            disabled={joinInput.trim().length < 4}
          >
            <Text style={styles.joinBtnText}>Join</Text>
          </TouchableOpacity>
        </View>

        {joinedRoom && (
          <View style={[styles.joinedBanner, { backgroundColor: blue + '14', borderColor: blue + '30' }]}>
            <View style={[styles.onlineDot, { backgroundColor: blue }]} />
            <Text style={[styles.joinedText, { color: blue }]}>
              Connected to room {joinedRoom} · Pears P2P
            </Text>
            <TouchableOpacity onPress={() => setJoinedRoom(null)}>
              <Text style={[styles.leaveText, { color: theme.textSecondary }]}>Leave</Text>
            </TouchableOpacity>
          </View>
        )}
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
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {joinedRoom ? `Room ${joinedRoom}` : 'Your room is ready'}
            </Text>
            <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
              {joinedRoom
                ? 'You joined this room. Share your thoughts with the fans.'
                : `Share key ${roomKey} with fans nearby to chat. No internet needed.`}
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
            placeholder={`Message room ${activeRoom}...`}
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
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  onlineDot: { width: 6, height: 6, borderRadius: 3 },

  roomSection: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 10 },
  keyCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12,
  },
  keyCardLeft: { gap: 2 },
  keyLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  keyValue: { fontSize: 24, fontWeight: '900', letterSpacing: 3 },
  copyBtn: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  copyBtnText: { fontSize: 12, fontWeight: '700' },

  joinRow: { flexDirection: 'row', gap: 8 },
  joinInput: {
    flex: 1, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, fontWeight: '700', letterSpacing: 2,
  },
  joinBtn: { borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center' },
  joinBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  joinedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10,
  },
  joinedText: { flex: 1, fontSize: 12, fontWeight: '600' },
  leaveText: { fontSize: 12, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 6 },
  emptyState: { paddingTop: 32, gap: 8, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
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
