import React from 'react';
import Svg, { Path, Circle, Rect, Line, G, Polygon } from 'react-native-svg';

interface IconProps { size?: number; color?: string; strokeWidth?: number; }

const sw = (p: IconProps) => p.strokeWidth ?? 1.8;

// Football / soccer ball
export const IconBall = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={sw({ strokeWidth: 1.8 })} />
    <Polygon points="12,7 14.5,9 13.5,12 10.5,12 9.5,9" stroke={color} strokeWidth="1.5" fill="none" />
    <Line x1="12" y1="7" x2="12" y2="2" stroke={color} strokeWidth="1.5" />
    <Line x1="14.5" y1="9" x2="19" y2="7" stroke={color} strokeWidth="1.5" />
    <Line x1="13.5" y1="12" x2="17" y2="15.5" stroke={color} strokeWidth="1.5" />
    <Line x1="10.5" y1="12" x2="7" y2="15.5" stroke={color} strokeWidth="1.5" />
    <Line x1="9.5" y1="9" x2="5" y2="7" stroke={color} strokeWidth="1.5" />
  </Svg>
);

// Target / crosshair — for Predictor
export const IconTarget = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.8" />
    <Circle cx="12" cy="12" r="6" stroke={color} strokeWidth="1.8" />
    <Circle cx="12" cy="12" r="2" fill={color} />
    <Line x1="12" y1="2" x2="12" y2="6" stroke={color} strokeWidth="1.8" />
    <Line x1="12" y1="18" x2="12" y2="22" stroke={color} strokeWidth="1.8" />
    <Line x1="2" y1="12" x2="6" y2="12" stroke={color} strokeWidth="1.8" />
    <Line x1="18" y1="12" x2="22" y2="12" stroke={color} strokeWidth="1.8" />
  </Svg>
);

// Camera — for Scout Lens
export const IconCamera = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    <Circle cx="12" cy="13" r="4" stroke={color} strokeWidth="1.8" />
  </Svg>
);

// Calendar — for the Matches tab
export const IconCalendar = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="3" y="5" width="18" height="16" rx="2.5" stroke={color} strokeWidth="1.8" />
    <Line x1="3" y1="10" x2="21" y2="10" stroke={color} strokeWidth="1.8" />
    <Line x1="8" y1="2.5" x2="8" y2="6.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Line x1="16" y1="2.5" x2="16" y2="6.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Circle cx="8.5" cy="15" r="1.4" fill={color} />
    <Circle cx="13" cy="15" r="1.4" fill={color} />
  </Svg>
);

// House — for the Home tab
export const IconHome = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 11.5L12 4l8 7.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M6 10v9a1 1 0 001 1h3v-5h4v5h3a1 1 0 001-1v-9" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
  </Svg>
);

// Sparkle — for AI Coach
export const IconSparkle = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    <Path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
  </Svg>
);

// Clock — history entry point
export const IconClock = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="9.5" stroke={color} strokeWidth="1.8" />
    <Path d="M12 7v5l3.5 2" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// Tactics — whiteboard with a run line
export const IconTactics = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="3" y="4" width="18" height="13" rx="2" stroke={color} strokeWidth="1.8" />
    <Path d="M7 20h10M7 14l4-5 3 3 3-4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// Players — two figures
export const IconPlayers = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="9" cy="8" r="3.2" stroke={color} strokeWidth="1.8" />
    <Path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6M16 11a3 3 0 100-6M21 20c0-2.8-1.8-5-4.2-5.8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);

// Trophy
export const IconTrophy = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M7 4h10v5a5 5 0 01-10 0V4z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    <Path d="M7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3M10 15v2h4v-2M8 21h8" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// Rules — document with lines
export const IconRules = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="5" y="3" width="14" height="18" rx="2" stroke={color} strokeWidth="1.8" />
    <Path d="M8.5 8h7M8.5 12h7M8.5 16h4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);

// Share — arrow out of tray
export const IconShare = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 3v12M8 7l4-4 4 4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);

// Copy — two stacked rects
export const IconCopy = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2" stroke={color} strokeWidth="1.8" />
    <Path d="M15 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v9a2 2 0 002 2h2.5" stroke={color} strokeWidth="1.8" />
  </Svg>
);

// Refresh — two arcs
export const IconRefresh = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 12a8 8 0 0113.9-5.4M20 12a8 8 0 01-13.9 5.4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Path d="M17.5 3v4h-4M6.5 21v-4h4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// Settings / gear
export const IconSettings = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.8" />
    <Path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke={color} strokeWidth="1.8" />
  </Svg>
);

// Back arrow
export const IconBack = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M19 12H5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Path d="M12 19l-7-7 7-7" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// Send
export const IconSend = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M22 2L11 13" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Path d="M22 2L15 22l-4-9-9-4 20-7z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
  </Svg>
);

// Models / cube
export const IconModels = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    <Path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);

// Stop square — for cancel inference
export const IconStop = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="4" y="4" width="16" height="16" rx="2" stroke={color} strokeWidth="1.8" fill={color} />
  </Svg>
);

// Kebab menu — three vertical dots, for a dropdown trigger
export const IconMore = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="5" r="1.8" fill={color} />
    <Circle cx="12" cy="12" r="1.8" fill={color} />
    <Circle cx="12" cy="19" r="1.8" fill={color} />
  </Svg>
);

// Photo / gallery
export const IconPhoto = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth="1.8" />
    <Circle cx="8.5" cy="8.5" r="1.5" fill={color} />
    <Path d="M21 15l-5-5L5 21" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
  </Svg>
);

