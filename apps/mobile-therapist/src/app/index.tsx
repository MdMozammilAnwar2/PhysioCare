import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, useRouter, type Href } from 'expo-router';
import { api, tokens } from '../lib/api';
import { F, Button, C, s } from '../lib/ui';
import { Logo } from '../lib/logo';

// Signed in → go where the physio is in their journey: onboarding, verification status, or schedule.
export default function Welcome() {
  const router = useRouter();
  const [dest, setDest] = useState<Href | 'welcome' | null>(null);
  useEffect(() => {
    (async () => {
      if (!(await tokens.load())) return setDest('welcome');
      try {
        const p = await api.profile();
        if (!p.profile?.home_lat) return setDest('/onboarding');
        setDest(p.profile.verification_status === 'verified' ? '/schedule' : '/status');
      } catch { await tokens.clear(); setDest('welcome'); }
    })();
  }, []);
  if (dest === null) return null;
  if (dest !== 'welcome') return <Redirect href={dest} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.navy, padding: 24, paddingTop: 96, justifyContent: 'space-between' }}>
      <View style={{ gap: 14 }}>
        <Logo variant="dark" size={40} suffix="Partner" />
        <Text style={[s.h1, { color: '#fff', fontSize: 38, lineHeight: 42 }]}>Patients near you. Your prices. Paid every week.</Text>
        <Text style={[s.sub, { color: 'rgba(255,255,255,0.85)' }]}>For verified physiotherapists. Safety built in: check-in codes, SOS and zone rules.</Text>
      </View>
      <Button title="Join or sign in" onPress={() => router.push('/signin')} />
    </View>
  );
}
