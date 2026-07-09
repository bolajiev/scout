import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getTheme } from '../theme';
import TabBar from '../components/TabBar';

import SplashScreen from '../screens/SplashScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import HomeScreen from '../screens/HomeScreen';
import MatchAIScreen from '../screens/MatchAIScreen';
import PredictorScreen from '../screens/PredictorScreen';
import ModelsScreen from '../screens/ModelsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import DownloadScreen from '../screens/DownloadScreen';
import AboutScreen from '../screens/AboutScreen';
import HistoryScreen from '../screens/HistoryScreen';
import PredictionResultScreen from '../screens/PredictionResultScreen';
import MatchDetailScreen from '../screens/MatchDetailScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Dark only — the app never supported a usable light theme in practice
// and the toggle was more confusing than useful. useTheme() stays around
// as the hook every screen already calls via getTheme(useTheme()).
export const useTheme = () => 'dark' as const;

// ─── Main tabs: Matches / Predict / Coach ──────────────────────────────────
// Three features, nothing else. Scout Lens was removed as a screen — vision
// returns later as an upgrade to Coach (camera icon in the input bar), not
// as its own tab; Coach's message type already allows an optional image for
// that. Settings/History/Models/About/Download stay outside this navigator,
// pushed on top of the whole tab bar from wherever they're triggered.
function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Predictor" component={PredictorScreen} />
      <Tab.Screen name="MatchAI" component={MatchAIScreen} />
    </Tab.Navigator>
  );
}

// ─── Root stack ───────────────────────────────────────────────────────────────

export default function AppNavigator() {
  const theme = getTheme('dark');

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
        <Stack.Screen name="Splash"     component={SplashScreen} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="MainTabs"   component={MainTabs} />
        <Stack.Screen name="Models" component={ModelsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Download" component={DownloadScreen} options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="About"    component={AboutScreen}   options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="History"  component={HistoryScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="PredictionResult" component={PredictionResultScreen} options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="MatchDetail" component={MatchDetailScreen} options={{ animation: 'slide_from_bottom' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
