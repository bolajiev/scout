import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState, AppStateStatus } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useFonts, Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black } from '@expo-google-fonts/archivo';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import AppNavigator from './src/navigation/AppNavigator';
import { llmManager } from './src/utils/modelManager';
import { clearInferenceNotifications, cancelActiveInference, hasActiveInference } from './src/utils/bgNotification';

// Release model when app goes to background.
// 30-second grace period so quick task-switching doesn't reload the model.
// CRITICAL ORDER: cancel any active generation first and give llama.cpp a
// moment to settle — unloading the model mid-generation is a native
// use-after-free and crashed the app when users switched away and back.
let bgReleaseTimer: ReturnType<typeof setTimeout> | null = null;
let bgSettleTimer: ReturnType<typeof setTimeout> | null = null;

AppState.addEventListener('change', (next: AppStateStatus) => {
  if (next === 'background') {
    bgReleaseTimer = setTimeout(() => {
      cancelActiveInference();
      bgSettleTimer = setTimeout(async () => {
        // If a run is somehow still registered, skip this cycle — memory
        // pressure is better than a native crash
        if (hasActiveInference()) return;
        await clearInferenceNotifications();
        await llmManager.release().catch(() => {});
      }, 2_000);
    }, 30_000);
  } else if (next === 'active') {
    if (bgReleaseTimer !== null) { clearTimeout(bgReleaseTimer); bgReleaseTimer = null; }
    if (bgSettleTimer !== null) { clearTimeout(bgSettleTimer); bgSettleTimer = null; }
  }
});

// Must be called before any notification scheduling
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

interface EBState { hasError: boolean; message: string }

class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, EBState> {
  state: EBState = { hasError: false, message: '' };

  static getDerivedStateFromError(e: Error): EBState {
    return { hasError: true, message: e?.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={s.root}>
          <Text style={s.title}>Something went wrong</Text>
          <Text selectable style={s.msg}>{this.state.message}</Text>
          <TouchableOpacity
            style={s.btn}
            onPress={() => this.setState({ hasError: false, message: '' })}
          >
            <Text style={s.btnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050505', justifyContent: 'center', alignItems: 'center', padding: 32 },
  title: { color: '#f5f5f5', fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  msg: { color: '#9a9a9a', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  btn: { backgroundColor: '#C6F53A', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14 },
  btnText: { color: '#0b0b0b', fontSize: 15, fontWeight: '700' },
});

export default function App() {
  // Fonts must be ready before anything renders — Archivo for display/
  // headers (700/800/900), Inter for body copy (400/500/600). Blank view
  // matching the paper background instead of `return null`, so there's
  // no flash between the native splash and first paint.
  const [fontsLoaded] = useFonts({
    Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
  });
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#050505' }} />;
  }

  return (
    <ErrorBoundary>
      <StatusBar style="light" />
      <AppNavigator />
    </ErrorBoundary>
  );
}
