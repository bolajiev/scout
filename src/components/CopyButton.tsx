import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';

interface Props {
  text: string;
  color: string;
  size?: number;
}

export default function CopyButton({ text, color, size = 12 }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <TouchableOpacity onPress={handleCopy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.btn}>
      <Text style={[styles.label, { color, fontSize: size }]}>
        {copied ? 'Copied' : 'Copy'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 2 },
  label: { fontWeight: '600' },
});
