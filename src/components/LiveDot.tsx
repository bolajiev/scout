import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';

// Small pulsing dot for anything marked LIVE — a static dot reads as just
// another color-coded label; the pulse is what actually says "this is
// happening right now" at a glance.
export default function LiveDot({ color = '#fff', size = 6, style }: { color?: string; size?: number; style?: ViewStyle }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.3, duration: 550, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: pulse },
        style,
      ]}
    />
  );
}
