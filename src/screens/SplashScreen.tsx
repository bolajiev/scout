import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getTheme } from '../theme';
import { useTheme } from '../navigation/AppNavigator';
import { initModelsDirectory, syncModelsFromDisk, shouldShowWelcome } from '../utils/storage';
import { requestNotificationPermission } from '../utils/bgNotification';

const ICON = require('../../assets/icon.png');

export default function SplashScreen() {
  const navigation = useNavigation<any>();
  const theme = getTheme(useTheme());
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
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
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 70, useNativeDriver: true }),
    ]).start();

    boot();
  }, []);

  if (bootError) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Image source={ICON} style={styles.errorIcon} resizeMode="contain" />
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
    <View style={[styles.container, { backgroundColor: '#0A0A0A' }]}>
      <Animated.View style={[styles.logoWrap, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
        <Image source={ICON} style={styles.icon} resizeMode="contain" />
        <Text style={[styles.wordmark, { color: '#fff' }]}>SCOUT</Text>
        <Text style={[styles.tagline, { color: 'rgba(255,255,255,0.45)' }]}>On-Device Football AI</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logoWrap: { alignItems: 'center', gap: 20 },
  icon: { width: 110, height: 110, borderRadius: 26 },
  wordmark: { fontSize: 32, fontWeight: '900', letterSpacing: 6 },
  tagline: { fontSize: 12, fontWeight: '500', letterSpacing: 1.2 },
  errorIcon: { width: 72, height: 72, borderRadius: 18, marginBottom: 20 },
  errorTitle: { fontSize: 20, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  errorMsg: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  retryBtn: { paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14 },
  retryText: { fontSize: 15, fontWeight: '700' },
});
