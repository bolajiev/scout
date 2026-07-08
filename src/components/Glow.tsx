import React, { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';

// The v3 mock's signature card treatment: one soft volt radial glow
// anchored to a top corner, fading to nothing — on a near-black card.
// Done with react-native-svg's RadialGradient (already a dependency), no
// expo-linear-gradient needed. useId keeps gradient defs unique when
// several glows render in one tree.
export default function Glow({
  color = '#C6F53A',
  opacity = 0.14,
  anchor = 'tr',
}: {
  color?: string;
  opacity?: number;
  anchor?: 'tl' | 'tr';
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient
          id={id}
          cx={anchor === 'tr' ? '0.85' : '0.15'}
          cy="-0.1"
          rx="1.1"
          ry="0.9"
        >
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
