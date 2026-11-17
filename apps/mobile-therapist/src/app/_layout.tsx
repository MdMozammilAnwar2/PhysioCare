import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { api, type Status } from '../lib/api';
import { Button, C, s } from '../lib/ui';

const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
const older = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0); return false; };

// Every app checks the public status API on start and every 60 s.
export default function RootLayout() {
  const [status, setStatus] = useState<Status | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    const check = () => api.status().then(st => { setStatus(st); setDown(false); }).catch(() => setDown(true));
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  const min = status?.minAppVersion?.therapist;
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
          <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>{down ? 'Can’t reach PhysioConnect. Your booked visits are not affected.' : status?.maintenance.message ?? 'Scheduled maintenance in progress.'}</Text>
        </View>
      )}
      <Stack screenOptions={{ headerShadowVisible: false, headerStyle: { backgroundColor: C.bg }, headerTintColor: C.brand, headerTitle: '', contentStyle: { backgroundColor: C.bg } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}
