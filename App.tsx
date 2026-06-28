import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import AppNavigator from './src/navigation/AppNavigator';

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
  root: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', padding: 32 },
  title: { color: '#FDC803', fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  msg: { color: '#aaa', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  btn: { backgroundColor: '#FDC803', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14 },
  btnText: { color: '#000', fontSize: 15, fontWeight: '700' },
});

export default function App() {
  return (
    <ErrorBoundary>
      <StatusBar style="light" />
      <AppNavigator />
    </ErrorBoundary>
  );
}
