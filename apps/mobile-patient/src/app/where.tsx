import { useEffect, useRef, useState } from 'react';
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
  const [searchOn, setSearchOn] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ placeId: string; main?: string; secondary?: string; text?: string }[]>([]);
  const [picked, setPicked] = useState<{ placeId: string; formatted: string; lat: number; lng: number } | null>(null);
  const session = useRef(String(Date.now()) + Math.random().toString(36).slice(2));
  useEffect(() => { api.zones().then(r => setZones(r.zones)).catch(() => setError('Couldn’t load areas.')); api.mapsConfig().then(c => setSearchOn(c.search)).catch(() => undefined); }, []);
  // Google address search (only when maps is switched on on the server).
  useEffect(() => {
    if (!searchOn || query.trim().length < 3 || picked?.formatted === query) { setResults([]); return; }
    const t = setTimeout(() => api.searchAddress(query, session.current).then(r => setResults(r.results)).catch(() => setResults([])), 300);
    return () => clearTimeout(t);
  }, [query, searchOn, picked]);
  async function pick(placeId: string) {
    const r = await api.place(placeId, session.current);
    session.current = String(Date.now()) + Math.random().toString(36).slice(2);
    setPicked(r.place); setQuery(r.place.formatted); setResults([]); setArea(null);
    if (!line1) setLine1(r.place.formatted.split(',').slice(0, 2).join(',').slice(0, 200));
  }

  async function save() {
    if (!area && !picked) return setError(searchOn ? 'Search your address or pick your area.' : 'Pick your area.');
    if (line1.trim().length < 5) return setError('Enter your house and street.');
    setError(null);
    try { setSaved(await api.addAddress(picked ? { line1, lat: picked.lat, lng: picked.lng, placeId: picked.placeId, formatted: picked.formatted } : { line1, lat: area!.lat, lng: area!.lng })); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); }
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
            {searchOn && (
              <View style={{ gap: 6 }}>
                <Field label="Search your address" value={query} onChangeText={t => { setQuery(t); if (picked && t !== picked.formatted) setPicked(null); }} placeholder="Society, building or street" />
                {results.map(r => (
                  <Pressable key={r.placeId} onPress={() => pick(r.placeId)} accessibilityRole="button" style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.white, borderWidth: 1, borderColor: C.line }}>
                    <Text style={{ fontFamily: F.w700, color: C.navy }}>{r.main ?? r.text}</Text>
                    {r.secondary ? <Text style={s.muted}>{r.secondary}</Text> : null}
                  </Pressable>
                ))}
                {picked && <Text style={{ color: C.green, fontFamily: F.w600 }}>📍 {picked.formatted}</Text>}
              </View>
            )}
            {!picked && <Text style={s.label}>{searchOn ? 'Or pick your area' : 'Your area in Patna'}</Text>}
            {!picked && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {zones.map(z => (
                <Pressable key={z.id} onPress={() => setArea(z)} accessibilityRole="button" accessibilityState={{ selected: area?.id === z.id }}
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: area?.id === z.id ? C.navy : C.white, borderWidth: 1, borderColor: C.line }}>
                  <Text style={{ color: area?.id === z.id ? C.white : C.navy, fontFamily: F.w600 }}>{z.name}</Text>
                </Pressable>
              ))}
            </View>}
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
