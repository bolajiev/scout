import { Platform } from 'react-native';

// Font family name constants — must match the keys passed to useFonts() in
// App.tsx exactly (that's the string React Native looks up at render time).
// Archivo = display/headers (the v3 mock's condensed-900 headlines), Inter =
// body copy, mono = eyebrows/records/tabular numbers per the v3 design's
// --font-mono usage.
export const fonts = {
  displayBold:      'Archivo_700Bold',
  displayExtraBold: 'Archivo_800ExtraBold',
  displayBlack:     'Archivo_900Black',
  bodyRegular:      'Inter_400Regular',
  bodyMedium:       'Inter_500Medium',
  bodySemiBold:     'Inter_600SemiBold',
  mono:             Platform.OS === 'ios' ? 'Menlo' : 'monospace',
};
