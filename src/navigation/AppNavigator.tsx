import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, TouchableOpacity,
  Animated, Dimensions, useColorScheme,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { ThemeMode } from '../types';
import { getTheme } from '../theme';
import { getThemeOverride, setThemeOverride } from '../utils/storage';
import SplashScreen from '../screens/SplashScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import HomeScreen from '../screens/HomeScreen';
import ChatScreen from '../screens/ChatScreen';
import ScanScreen from '../screens/ScanScreen';
import LensHubScreen from '../screens/LensHubScreen';
import HistoryScreen from '../screens/HistoryScreen';
import VoiceScreen from '../screens/VoiceScreen';
import DeepScreen from '../screens/DeepScreen';
import ResultScreen from '../screens/ResultScreen';
import LensResultScreen from '../screens/LensResultScreen';
import ModelsScreen from '../screens/ModelsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import DownloadScreen from '../screens/DownloadScreen';
import ScribeHubScreen from '../screens/ScribeHubScreen';
import DeepHubScreen from '../screens/DeepHubScreen';
import FilePreviewScreen from '../screens/FilePreviewScreen';
import AboutScreen from '../screens/AboutScreen';
import Sidebar from '../components/Sidebar';
import AIChatScreen from '../screens/AIChatScreen';
import AIChatHubScreen from '../screens/AIChatHubScreen';
import NearbyScreen from '../screens/NearbyScreen';
import PeelFunScreen from '../screens/PeelFunScreen';

const Stack = createNativeStackNavigator();
const { width: SW } = Dimensions.get('window');
const SIDEBAR_W = SW * 0.78;

type ThemeCtx = { mode: ThemeMode; toggle: () => void };
const ThemeContext = createContext<ThemeCtx>({ mode: 'dark', toggle: () => {} });
export const useTheme = () => useContext(ThemeContext).mode;
export const useThemeToggle = () => useContext(ThemeContext).toggle;

type SidebarCtx = { open: () => void; close: () => void };
const SidebarContext = createContext<SidebarCtx>({ open: () => {}, close: () => {} });
export const useSidebar = () => useContext(SidebarContext);

function MainScreen() {
  const themeMode = useTheme();
  const theme = getTheme(themeMode);
  const navigation = useNavigation<any>();
  const translateX = useRef(new Animated.Value(-SIDEBAR_W)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [sidebarVisible, setSidebarVisible] = useState(false);

  const open = useCallback(() => {
    setSidebarVisible(true);
    Animated.parallel([
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8, tension: 80 }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, []);

  const close = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateX, { toValue: -SIDEBAR_W, useNativeDriver: true, friction: 10, tension: 80 }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => setSidebarVisible(false));
  }, []);

  const handleNavigate = useCallback((screen: string) => {
    close();
    setTimeout(() => navigation.navigate(screen), 250);
  }, [close, navigation]);

  return (
    <SidebarContext.Provider value={{ open, close }}>
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <HomeScreen />

        {sidebarVisible && (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity, zIndex: 10 }]} pointerEvents="box-none">
            <TouchableOpacity
              style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.65)' }]}
              onPress={close}
              activeOpacity={1}
            />
          </Animated.View>
        )}

        <Animated.View style={[
          styles.sidebar,
          { width: SIDEBAR_W, transform: [{ translateX }], zIndex: 11, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 4, height: 0 }, elevation: 20 },
        ]}>
          <Sidebar onClose={close} onNavigate={handleNavigate} />
        </Animated.View>
      </View>
    </SidebarContext.Provider>
  );
}

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
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="Main" component={MainScreen} />
          <Stack.Screen name="Lens" component={LensHubScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="LensScan" component={ScanScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Voice" component={VoiceScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Scribe" component={ScribeHubScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ScribeChat" component={ChatScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Deep" component={DeepHubScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="DeepResearch" component={DeepScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="History" component={HistoryScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Result" component={ResultScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="LensResult" component={LensResultScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="Nearby" component={NearbyScreen} options={{ animation: 'slide_from_right' }} />
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
          <Stack.Screen name="FilePreview" component={FilePreviewScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="About" component={AboutScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="AIChatHub" component={AIChatHubScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="AIChat" component={AIChatScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="PeelFun" component={PeelFunScreen} options={{ animation: 'slide_from_right' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeContext.Provider>
  );
}

const styles = StyleSheet.create({
  sidebar: { position: 'absolute', top: 0, bottom: 0, left: 0 },
});
