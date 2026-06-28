import React, { useRef, useEffect } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';

const YELLOW = '#FDC803';

interface Props {
  label?: string;
  size?: number;
}

export default function PeekLoader({ label, size = 56 }: Props) {
  const rotAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotAnim, { toValue: 1, duration: 1100, useNativeDriver: true })
    ).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.12, duration: 550, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 550, useNativeDriver: true }),
    ])).start();
    return () => {
      rotAnim.stopAnimation();
      pulseAnim.stopAnimation();
    };
  }, []);

  const rotate = rotAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.root}>
      {/* Outer glow ring */}
      <View style={[styles.outerRing, { width: size + 18, height: size + 18, borderRadius: (size + 18) / 2 }]} />
      {/* Spinning arc */}
      <Animated.View
        style={[
          styles.spinRing,
          { width: size, height: size, borderRadius: size / 2, transform: [{ rotate }, { scale: pulseAnim }] },
        ]}
      />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 18 },
  outerRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: YELLOW + '28',
  },
  spinRing: {
    borderWidth: 3,
    borderColor: YELLOW,
    borderTopColor: 'transparent',
    borderLeftColor: YELLOW + '60',
  },
  label: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: '700',
    color: YELLOW,
    letterSpacing: 0.2,
  },
});
