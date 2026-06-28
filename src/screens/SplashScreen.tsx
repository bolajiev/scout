import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { initModelsDirectory, syncModelsFromDisk, shouldShowWelcome } from '../utils/storage';
import { requestNotificationPermission } from '../utils/bgNotification';

export default function SplashScreen() {
  const navigation = useNavigation<any>();
  const theme = getTheme(useTheme());
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const [bootError, setBootError] = useState<string | null>(null);

  const boot = async () => {
    try {
      await initModelsDirectory();
      await syncModelsFromDisk();
      requestNotificationPermission().catch(() => {});
      const showWelcome = await shouldShowWelcome();
      navigation.replace(showWelcome ? 'Onboarding' : 'Main');
    } catch (e: any) {
      setBootError(e?.message || 'Startup error. Tap Retry to try again.');
    }
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(boot, 1600);
    return () => clearTimeout(timer);
  }, []);

  if (bootError) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Text style={[styles.errorTitle, { color: theme.text }]}>Startup Failed</Text>
        <Text selectable style={[styles.errorMsg, { color: theme.textSecondary }]}>{bootError}</Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: theme.accent }]}
          onPress={() => { setBootError(null); boot(); }}
        >
          <Text style={[styles.retryText, { color: theme.accentFg }]}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Animated.View style={[styles.logoWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        {/* Scout wordmark — no image file needed */}
        <View style={[styles.logoMark, { backgroundColor: theme.accent }]}>
          <Text style={styles.logoLetter}>S</Text>
        </View>
        <Text style={[styles.wordmark, { color: theme.text }]}>SCOUT</Text>
        <Text style={[styles.tagline, { color: theme.textSecondary }]}>On-Device Football AI</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logoWrap: { alignItems: 'center', gap: 16 },
  logoMark: {
    width: 80, height: 80, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  logoLetter: { fontSize: 44, fontWeight: '900', color: '#fff', letterSpacing: -1 },
  wordmark: { fontSize: 36, fontWeight: '900', letterSpacing: 6 },
  tagline: { fontSize: 13, fontWeight: '500', letterSpacing: 1 },
  errorTitle: { fontSize: 20, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  errorMsg: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  retryBtn: { paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14 },
  retryText: { fontSize: 15, fontWeight: '700' },
});
