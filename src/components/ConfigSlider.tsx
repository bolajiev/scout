import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, PanResponder, LayoutChangeEvent,
} from 'react-native';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  warn?: string | null;
  theme: any;
  onChange: (v: number) => void;
}

export default function ConfigSlider({
  label, value, min, max, step = 1, decimals = 0, warn, theme, onChange,
}: Props) {
  const [inputVal, setInputVal] = useState(value.toFixed(decimals));
  const trackRef = useRef<View>(null);
  const trackWidthRef = useRef(0);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const snapToStep = (v: number) => Math.round(v / step) * step;
  const fillRatio = Math.max(0, Math.min(1, (value - min) / (max - min)));

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const tw = trackWidthRef.current;
      if (!tw) return;
      const x = e.nativeEvent.locationX;
      const ratio = Math.max(0, Math.min(1, x / tw));
      const raw = min + ratio * (max - min);
      const snapped = clamp(snapToStep(raw));
      setInputVal(snapped.toFixed(decimals));
      onChange(snapped);
    },
    onPanResponderMove: (e) => {
      const tw = trackWidthRef.current;
      if (!tw) return;
      const x = e.nativeEvent.locationX;
      const ratio = Math.max(0, Math.min(1, x / tw));
      const raw = min + ratio * (max - min);
      const snapped = clamp(snapToStep(raw));
      setInputVal(snapped.toFixed(decimals));
      onChange(snapped);
    },
  })).current;

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    trackWidthRef.current = e.nativeEvent.layout.width;
  };

  const handleInputEnd = (text: string) => {
    const parsed = parseFloat(text);
    if (!isNaN(parsed)) {
      const snapped = clamp(snapToStep(parsed));
      setInputVal(snapped.toFixed(decimals));
      onChange(snapped);
    } else {
      setInputVal(value.toFixed(decimals));
    }
  };

  // Keep input in sync when value changes externally
  React.useEffect(() => {
    setInputVal(value.toFixed(decimals));
  }, [value]);

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <View style={styles.row}>
        <Text style={[styles.currentVal, { color: theme.textSecondary }]}>
          {value.toFixed(decimals)}
        </Text>
        <View
          ref={trackRef}
          style={[styles.track, { backgroundColor: theme.border }]}
          onLayout={handleTrackLayout}
          {...panResponder.panHandlers}
        >
          <View style={[styles.fill, { backgroundColor: theme.accent, width: `${fillRatio * 100}%` }]} />
          <View style={[styles.thumb, { backgroundColor: theme.accent, left: `${fillRatio * 100}%` }]} />
        </View>
        <TextInput
          style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
          value={inputVal}
          onChangeText={setInputVal}
          onBlur={() => handleInputEnd(inputVal)}
          onSubmitEditing={() => handleInputEnd(inputVal)}
          keyboardType="numeric"
          returnKeyType="done"
          selectTextOnFocus
        />
      </View>
      {warn ? <Text style={[styles.warn, { color: '#F59E0B' }]}>{warn}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: 12, gap: 8 },
  label: { fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  currentVal: { fontSize: 13, fontWeight: '500', minWidth: 42, textAlign: 'right', fontVariant: ['tabular-nums'] },
  track: {
    flex: 1, height: 6, borderRadius: 3, overflow: 'visible',
    justifyContent: 'center', position: 'relative',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  thumb: {
    position: 'absolute', width: 2, height: 20, borderRadius: 1,
    top: -7, marginLeft: -1,
  },
  input: {
    width: 74, height: 38, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 10, fontSize: 14, fontWeight: '600',
    textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  warn: { fontSize: 12, lineHeight: 16 },
});
