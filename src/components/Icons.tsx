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

// Chat bubbles — for Fan Room
export const IconFanRoom = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    <Line x1="8" y1="9" x2="16" y2="9" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <Line x1="8" y1="13" x2="13" y2="13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

// Settings / gear
export const IconSettings = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.8" />
    <Path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke={color} strokeWidth="1.8" />
  </Svg>
);

// Download
export const IconDownload = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Polygon points="7 10 12 15 17 10" stroke={color} strokeWidth="1.8" strokeLinejoin="round" fill="none" />
    <Line x1="12" y1="15" x2="12" y2="3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
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

// Info / about
export const IconInfo = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.8" />
    <Line x1="12" y1="16" x2="12" y2="12" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Line x1="12" y1="8" x2="12.01" y2="8" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
  </Svg>
);

// Stop square — for cancel inference
export const IconStop = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="4" y="4" width="16" height="16" rx="2" stroke={color} strokeWidth="1.8" fill={color} />
  </Svg>
);

// Trash
export const IconTrash = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Polygon points="3 6 5 6 21 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <Path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    <Path d="M10 11v6M14 11v6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
  </Svg>
);

// Copy
export const IconCopy = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="9" y="9" width="13" height="13" rx="2" stroke={color} strokeWidth="1.8" />
    <Path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
  </Svg>
);

// Wifi off — for offline/Pears indicator
export const IconOffline = ({ size = 24, color = '#fff' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Line x1="1" y1="1" x2="23" y2="23" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Path d="M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);
