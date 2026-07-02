import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ThemeMode } from '../types';
import { getTheme } from '../theme';
import { getThemeOverride, setThemeOverride } from '../utils/storage';

import SplashScreen from '../screens/SplashScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import HomeScreen from '../screens/HomeScreen';
import MatchAIScreen from '../screens/MatchAIScreen';
import PredictorScreen from '../screens/PredictorScreen';
import ScoutLensScreen from '../screens/ScoutLensScreen';
import ModelsScreen from '../screens/ModelsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import DownloadScreen from '../screens/DownloadScreen';
import AboutScreen from '../screens/AboutScreen';
import HistoryScreen from '../screens/HistoryScreen';

const Stack = createNativeStackNavigator();

type ThemeCtx = { mode: ThemeMode; toggle: () => void };
const ThemeContext = createContext<ThemeCtx>({ mode: 'dark', toggle: () => {} });
export const useTheme = () => useContext(ThemeContext).mode;
export const useThemeToggle = () => useContext(ThemeContext).toggle;

// ─── Root stack ───────────────────────────────────────────────────────────────

export default function AppNavigator() {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>(systemScheme === 'light' ? 'light' : 'dark');

  useEffect(() => {
    getThemeOverride().then((override) => {
      if (override) setThemeMode(override);
      else setThemeMode(systemScheme === 'light' ? 'light' : 'dark');
    }).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    const next: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(next);
    setThemeOverride(next);
  }, [themeMode]);

  const theme = getTheme(themeMode);

  return (
    <ThemeContext.Provider value={{ mode: themeMode, toggle }}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
          <Stack.Screen name="Splash"     component={SplashScreen} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="Main"       component={HomeScreen} />
          <Stack.Screen name="MatchAI"    component={MatchAIScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Predictor"  component={PredictorScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ScoutLens"  component={ScoutLensScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen
            name="Models"
            component={ModelsScreen}
            options={{
              headerShown: true, title: 'Models', animation: 'slide_from_right',
              headerStyle: { backgroundColor: theme.background }, headerTintColor: theme.text,
              headerShadowVisible: false, headerBackTitle: '',
            }}
          />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Download" component={DownloadScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="About"    component={AboutScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="History"  component={HistoryScreen} options={{ animation: 'slide_from_right' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeContext.Provider>
  );
}
