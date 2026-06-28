import React, { useEffect, useRef } from 'react';
import { View, Animated } from 'react-native';

interface Props {
  size?: number;
  color?: string;
  pulse?: boolean;
}

export function PeekLogo({ size = 80, color = '#FDC803', pulse = false }: Props) {
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1.08, duration: 1200, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ring1 = size;
  const ring2 = size * 0.66;
  const dot = size * 0.32;

  return (
    <Animated.View
      style={{
        width: ring1,
        height: ring1,
        borderRadius: ring1 / 2,
        borderWidth: Math.max(2, size * 0.03),
        borderColor: color + '28',
        justifyContent: 'center',
        alignItems: 'center',
        transform: [{ scale: anim }],
      }}
    >
      <View
        style={{
          width: ring2,
          height: ring2,
          borderRadius: ring2 / 2,
          borderWidth: Math.max(2, size * 0.03),
          borderColor: color + '65',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <View
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: color,
          }}
        />
      </View>
    </Animated.View>
  );
}
