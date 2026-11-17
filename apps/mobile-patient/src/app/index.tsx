import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { tokens } from '../lib/api';
import { Button, C, s } from '../lib/ui';

export default function Welcome() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => { tokens.load().then(setSignedIn); }, []);
  if (signedIn === null) return null;
  if (signedIn) return <Redirect href="/bookings" />;
  return (
    <View style={{ flex: 1, backgroundColor: C.brand, padding: 24, paddingTop: 96, justifyContent: 'space-between' }}>
      <View style={{ gap: 14 }}>
        <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 }}><Text style={{ color: '#fff', fontWeight: '700' }}>Now in Patna</Text></View>
        <Text style={[s.h1, { color: '#fff', fontSize: 40, lineHeight: 44 }]}>Physiotherapy. At home. Near you.</Text>
        <Text style={[s.sub, { color: 'rgba(255,255,255,0.9)' }]}>Verified physiotherapists, matched to your home and your recovery.</Text>
      </View>
      <View style={{ gap: 10 }}>
        <Button title="Get started" variant="ghost" onPress={() => router.push('/signin')} />
        <Text style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center', fontSize: 13 }}>PhysioConnect by Healthtropic</Text>
      </View>
    </View>
  );
}
