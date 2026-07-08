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
        {/* BUG FIX: cy was -0.1 — the gradient's own center sat ABOVE the
            card's top edge, so only the bottom half of the radial ellipse
            was ever inside the visible frame, reading as a glow abruptly
            "cut in half" at the top rather than a soft corner bleed.
            Moving the center just inside the frame lets the full shape
            render and fade naturally in every direction. */}
        <RadialGradient
          id={id}
          cx={anchor === 'tr' ? '0.85' : '0.15'}
          cy="0.12"
          rx="0.9"
          ry="0.7"
        >
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
