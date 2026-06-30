import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useColorScheme } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { ThemeMode } from '../types';
import { getTheme } from '../theme';
import { getThemeOverride, setThemeOverride } from '../utils/storage';

import SplashScreen from '../screens/SplashScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import HomeScreen from '../screens/HomeScreen';
import MatchAIScreen from '../screens/MatchAIScreen';
import PredictorScreen from '../screens/PredictorScreen';
import ScoutLensScreen from '../screens/ScoutLensScreen';
import FanRoomScreen from '../screens/FanRoomScreen';
import ModelsScreen from '../screens/ModelsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import DownloadScreen from '../screens/DownloadScreen';
import AboutScreen from '../screens/AboutScreen';
import HistoryScreen from '../screens/HistoryScreen';

import { IconHome, IconBall, IconTarget, IconCamera, IconFanRoom } from '../components/Icons';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

type ThemeCtx = { mode: ThemeMode; toggle: () => void };
const ThemeContext = createContext<ThemeCtx>({ mode: 'dark', toggle: () => {} });
export const useTheme = () => useContext(ThemeContext).mode;
export const useThemeToggle = () => useContext(ThemeContext).toggle;

// ─── Custom football tab bar ─────────────────────────────────────────────────

const TABS = [
  { name: 'Home',      Icon: IconHome,    label: 'Home' },
  { name: 'MatchAI',   Icon: IconBall,    label: 'Coach' },
  { name: 'Predictor', Icon: IconTarget,  label: 'Predict' },
  { name: 'ScoutLens', Icon: IconCamera,  label: 'Lens' },
  { name: 'FanRoom',   Icon: IconFanRoom, label: 'Room' },
];

function FootballTabBar({ state, navigation }: BottomTabBarProps) {
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const insets = useSafeAreaInsets();

  return (
    <View style={[
      styles.tabBar,
      { backgroundColor: theme.card, borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, 8) },
    ]}>
      {TABS.map((tab, index) => {
        const focused = state.index === index;
        const color = focused ? theme.accent : theme.textSecondary;
        return (
          <TouchableOpacity
            key={tab.name}
            style={styles.tabItem}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              navigation.navigate(tab.name);
            }}
            activeOpacity={0.7}
          >
            {focused && <View style={[styles.tabIndicator, { backgroundColor: theme.accent }]} />}
            <tab.Icon size={22} color={color} />
            <Text style={[styles.tabLabel, { color }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Main tabs ───────────────────────────────────────────────────────────────

function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <FootballTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home"      component={HomeScreen} />
      <Tab.Screen name="MatchAI"   component={MatchAIScreen} />
      <Tab.Screen name="Predictor" component={PredictorScreen} />
      <Tab.Screen name="ScoutLens" component={ScoutLensScreen} />
      <Tab.Screen name="FanRoom"   component={FanRoomScreen} />
    </Tab.Navigator>
  );
}

// ─── Root stack ───────────────────────────────────────────────────────────────

export default function AppNavigator() {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>(systemScheme === 'light' ? 'light' : 'dark');

  useEffect(() => {
    getThemeOverride().then((override) => {
      if (override) setThemeMode(override);
      else setThemeMode(systemScheme === 'light' ? 'light' : 'dark');
    });
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
          <Stack.Screen name="Main"       component={MainTabs} />
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

const styles = StyleSheet.create({
  tabBar: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 10 },
  tabItem: { flex: 1, alignItems: 'center', gap: 3, paddingBottom: 2, position: 'relative' },
  tabLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
  tabIndicator: { position: 'absolute', top: -10, width: 24, height: 3, borderRadius: 2 },
});
