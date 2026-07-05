import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getTheme } from '../theme';

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

// Dark only — the app never supported a usable light theme in practice
// and the toggle was more confusing than useful. useTheme() stays around
// as the hook every screen already calls via getTheme(useTheme()).
export const useTheme = () => 'dark' as const;

// ─── Root stack ───────────────────────────────────────────────────────────────

export default function AppNavigator() {
  const theme = getTheme('dark');

  return (
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
  );
}
