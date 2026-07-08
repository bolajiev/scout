import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

// "Matchday" signature motif — chalk pitch lines. 1.5px strokes referencing
// pitch markings: white on green (hero panels) or line-colored on paper
// (section dividers). Subtle background texture, never foreground
// decoration — the ONLY decorative element in the design system.

// Center-circle arc — sits behind hero panels, anchored to a corner.
export function CenterCircle({ color = '#FFFFFF', opacity = 0.12, size = 220 }: { color?: string; opacity?: number; size?: number }) {
  return (
    <Svg
      width={size} height={size} viewBox="0 0 220 220"
      style={{ position: 'absolute', right: -size * 0.3, bottom: -size * 0.35 }}
      pointerEvents="none"
    >
      <Circle cx="110" cy="110" r="80" stroke={color} strokeWidth="1.5" fill="none" opacity={opacity} />
      <Circle cx="110" cy="110" r="3" fill={color} opacity={opacity} />
      <Line x1="0" y1="110" x2="30" y2="110" stroke={color} strokeWidth="1.5" opacity={opacity * 0.7} />
    </Svg>
  );
}

// Halfway-line divider with a small center dot — between list sections.
export function HalfwayDivider({ color = '#E3E1D8' }: { color?: string }) {
  return (
    <View style={{ height: 12, justifyContent: 'center' }} pointerEvents="none">
      <Svg width="100%" height="12" viewBox="0 0 300 12" preserveAspectRatio="none">
        <Line x1="0" y1="6" x2="138" y2="6" stroke={color} strokeWidth="1.5" />
        <Circle cx="150" cy="6" r="3" stroke={color} strokeWidth="1.5" fill="none" />
        <Line x1="162" y1="6" x2="300" y2="6" stroke={color} strokeWidth="1.5" />
      </Svg>
    </View>
  );
}

// Corner-arc accent — top-left of a card.
export function CornerArc({ color = '#E3E1D8', size = 28 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
      <Path d="M 0 28 A 28 28 0 0 0 28 0" stroke={color} strokeWidth="1.5" fill="none" />
    </Svg>
  );
}
