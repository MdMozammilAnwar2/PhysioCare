import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold, useFonts } from '@expo-google-fonts/plus-jakarta-sans';
import { api, type Status } from '../lib/api';
import { F, Button, C, s } from '../lib/ui';

const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
const older = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0); return false; };

// Every app checks the public status API on start and every 60 s.
// Keep the splash screen up until the brand font (Plus Jakarta Sans) has loaded.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsReady, fontError] = useFonts({ PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  useEffect(() => { if (fontsReady || fontError) SplashScreen.hideAsync().catch(() => undefined); }, [fontsReady, fontError]);
  const [status, setStatus] = useState<Status | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    const check = () => api.status().then(st => { setStatus(st); setDown(false); }).catch(() => setDown(true));
    check();
    const t = setInterval(check, Number(process.env.EXPO_PUBLIC_STATUS_CHECK_SECONDS || 60) * 1000);
    return () => clearInterval(t);
  }, []);

  if (!fontsReady && !fontError) return null;
  const min = status?.minAppVersion?.patient;
  if (min && older(APP_VERSION, min)) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: 24, gap: 16 }}>
        <Text style={s.h1}>Update to continue</Text>
        <Text style={s.sub}>This version is no longer supported. The update includes safety and payment fixes.</Text>
        <Button title="Update now" onPress={() => undefined} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="dark" />
      {(down || status?.maintenance.enabled) && (
        <View style={{ backgroundColor: down ? '#F43F5E' : '#F59E0B', paddingTop: 48, paddingBottom: 8, paddingHorizontal: 16 }}>
          <Text style={{ color: '#fff', fontFamily: F.w700, textAlign: 'center' }}>{down ? 'Can’t reach PhysioCare. Your booked visits are not affected.' : status?.maintenance.message ?? 'Scheduled maintenance in progress.'}</Text>
        </View>
      )}
      <Stack screenOptions={{ headerShadowVisible: false, headerStyle: { backgroundColor: C.bg }, headerTintColor: C.brand, headerTitle: '', contentStyle: { backgroundColor: C.bg } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}
