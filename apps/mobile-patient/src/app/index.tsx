import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { tokens } from '../lib/api';
import { F, Button, C, s } from '../lib/ui';
import { Logo } from '../lib/logo';

export default function Welcome() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => { tokens.load().then(setSignedIn); }, []);
  if (signedIn === null) return null;
  if (signedIn) return <Redirect href="/bookings" />;
  return (
    <View style={{ flex: 1, backgroundColor: C.brand, padding: 24, paddingTop: 96, justifyContent: 'space-between' }}>
      <View style={{ gap: 14 }}>
        <Logo variant="reversed" size={40} endorsed />
        <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 }}><Text style={{ color: '#fff', fontFamily: F.w700 }}>Now in Patna</Text></View>
        <Text style={[s.h1, { color: '#fff', fontSize: 40, lineHeight: 44 }]}>Physiotherapy. At home. Near you.</Text>
        <Text style={[s.sub, { color: 'rgba(255,255,255,0.9)' }]}>Verified physiotherapists, matched to your home and your recovery.</Text>
      </View>
      <View style={{ gap: 10 }}>
        <Button title="Get started" variant="ghost" onPress={() => router.push('/signin')} />
      </View>
    </View>
  );
}
