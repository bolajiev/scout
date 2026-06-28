import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { saveMarkdownFile } from '../utils/fileService';

interface Props {
  text: string;
  title?: string;     // used as filename (without extension)
  theme: any;
  compact?: boolean;  // narrower row for tight spaces
}

export default function ResultActions({ text, title = 'peek-result', theme, compact }: Props) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleSave = () => {
    try {
      saveMarkdownFile(title, text);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {
      Alert.alert('Save Failed', 'Could not save the file.');
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({ message: text, title });
    } catch {}
  };

  const btn = (label: string, onPress: () => void, active: boolean) => (
    <TouchableOpacity
      style={[
        styles.btn,
        compact && styles.btnCompact,
        { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accent + '18' : 'transparent' },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.btnText, { color: active ? theme.accent : theme.textSecondary }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {btn(copied ? '✓ Copied' : 'Copy', handleCopy, copied)}
      {btn(saved ? '✓ Saved' : 'Save', handleSave, saved)}
      {btn('Share', handleShare, false)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginTop: 12 },
  rowCompact: { marginTop: 6, gap: 6 },
  btn: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  btnCompact: {
    paddingHorizontal: 10, paddingVertical: 5,
  },
  btnText: { fontSize: 12, fontWeight: '700' },
});
