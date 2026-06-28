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
  const slideAnim = useRef(new Animated.Value(16)).current;
  const [bootError, setBootError] = useState<string | null>(null);

  const boot = async () => {
    try {
      await initModelsDirectory();
      await syncModelsFromDisk();
      requestNotificationPermission().catch(() => {});
      const showWelcome = await shouldShowWelcome();
      navigation.replace(showWelcome ? 'Onboarding' : 'Main');
    } catch (e: any) {
      console.error('[boot] init failed:', e);
      setBootError(e?.message || 'Startup error. Tap Retry to try again.');
    }
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(boot, 1800);
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
      <Animated.Image
        source={require('../../peeklogo.png')}
        style={[styles.logo, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 36,
  },
  logo: {
    width: 120,
    height: 120,
    borderRadius: 30,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  errorMsg: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  retryBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
