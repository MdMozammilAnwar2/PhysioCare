import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, ApiError, draft, type Zone } from '../lib/api';
import { F, Button, C, Card, Chips, ErrorText, Field, Screen, ZonePill, s } from '../lib/ui';

export default function Where() {
  const router = useRouter();
  const [mode, setMode] = useState<'home' | 'video'>('home');
  const [zones, setZones] = useState<Zone[]>([]);
  const [area, setArea] = useState<Zone | null>(null);
  const [line1, setLine1] = useState('');
  const [saved, setSaved] = useState<{ id: string; zone: Zone } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.zones().then(r => setZones(r.zones)).catch(() => setError('Couldn’t load areas.')); }, []);

  async function save() {
    if (!area) return setError('Pick your area.');
    if (line1.trim().length < 5) return setError('Enter your house and street.');
    setError(null);
    try { setSaved(await api.addAddress({ line1, lat: area.lat, lng: area.lng })); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); }
  }
  function next() {
    Object.assign(draft, { mode, addressId: mode === 'home' ? saved?.id : undefined, zone: saved?.zone });
    router.push('/physio');
  }
  const blocked = saved?.zone.color === 'red';
  return (
    <Screen kicker="Step 2 of 4" title="Where should the session happen?">
      <Card>
        <Chips options={[['home', 'At home'], ['video', 'Video']]} value={mode} onChange={setMode} />
        {mode === 'home' && !saved && (
          <>
            <Text style={s.label}>Your area in Patna</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {zones.map(z => (
                <Pressable key={z.id} onPress={() => setArea(z)} accessibilityRole="button" accessibilityState={{ selected: area?.id === z.id }}
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: area?.id === z.id ? C.navy : C.white, borderWidth: 1, borderColor: C.line }}>
                  <Text style={{ color: area?.id === z.id ? C.white : C.navy, fontFamily: F.w600 }}>{z.name}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="House, street" value={line1} onChangeText={setLine1} placeholder="House 12, Road 4" />
            <Button title="Save address" onPress={save} variant="ghost" />
          </>
        )}
        {mode === 'home' && saved && (
          <View style={{ gap: 8 }}>
            <ZonePill color={saved.zone.color} name={saved.zone.name} />
            {saved.zone.color === 'orange' && <Text style={s.muted}>Home visits here run 8 AM – 6 PM.</Text>}
            {blocked && <Text style={{ color: C.red, fontFamily: F.w600 }}>Home visits are paused here right now. Choose Video instead.</Text>}
          </View>
        )}
        <ErrorText error={error} />
        <Button title="Find my physiotherapist" onPress={next} disabled={mode === 'home' && (!saved || blocked)} />
      </Card>
    </Screen>
  );
}
