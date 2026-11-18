import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError, fmtWhen, type LiveVisit, type Sos } from '../lib/api';
import { F, Button, C, Card, ErrorText, Screen, s } from '../lib/ui';

const EVERY = Number(process.env.EXPO_PUBLIC_LIVE_REFRESH_SECONDS || 15) * 1000;

// SOS alerts (acknowledge → call → resolve) and every visit in progress. Refreshes every 15 s.
export default function Live() {
  const [sos, setSos] = useState<Sos[]>([]);
  const [visits, setVisits] = useState<LiveVisit[] | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.live().then(r => { setSos(r.sos); setVisits(r.visits); }).catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t load.')), []);
  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, EVERY); return () => clearInterval(t); }, [load]));
  useEffect(() => { if (sos.some(x => x.status === 'open')) setError(null); }, [sos]);
  const act = (fn: () => Promise<unknown>) => fn().then(load).catch(e => setError(e instanceof ApiError ? e.message : 'Failed.'));
  return (
    <Screen kicker="Safety" title="Live visits & SOS">
      <ErrorText error={error} />
      {sos.length === 0 && <Card><Text style={{ color: C.green, fontFamily: F.w700 }}>No SOS open.</Text></Card>}
      {sos.map(x => (
        <View key={x.id} style={{ backgroundColor: x.status === 'open' ? '#FFE4E8' : C.white, borderRadius: 16, borderWidth: 2, borderColor: x.status === 'open' ? '#E11D48' : C.line, padding: 14, gap: 8 }}>
          <Text style={{ fontFamily: F.w800, fontSize: 18, color: x.status === 'open' ? '#BE123C' : C.navy }}>🚨 {x.raised_by_name ?? 'Physio'} · {x.status === 'open' ? 'OPEN' : 'Acknowledged'}</Text>
          <Text style={s.muted}>{fmtWhen(x.created_at)}</Text>
          <Button title={`Call ${x.raised_by_name ?? 'physio'}`} onPress={() => Linking.openURL(`tel:${x.raised_by_phone}`)} />
          {x.lat != null && <Button title="Open location in Maps" variant="ghost" onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${x.lat},${x.lng}`)} />}
          <Button title="If in danger: call 112" variant="ghost" onPress={() => Alert.alert('Call 112?', 'Use this if the physio is in immediate danger.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Call 112', style: 'destructive', onPress: () => Linking.openURL('tel:112') }])} />
          {x.status === 'open' && <Button title="Acknowledge (I’m handling this)" variant="dark" onPress={() => act(() => api.ackSos(x.id))} />}
          {x.status === 'acknowledged' && (
            <>
              <TextInput value={note[x.id] ?? ''} onChangeText={t => setNote({ ...note, [x.id]: t })} placeholder="What happened? How was it resolved?" multiline
                style={{ minHeight: 70, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, backgroundColor: C.white, textAlignVertical: 'top', fontFamily: F.w400 }} />
              <Button title="Resolve" disabled={(note[x.id] ?? '').trim().length < 3} onPress={() => act(() => api.resolveSos(x.id, note[x.id].trim()))} />
            </>
          )}
        </View>
      ))}
      <Text style={s.h2}>In progress</Text>
      {visits?.length === 0 && <Text style={s.muted}>No visits in progress.</Text>}
      {visits?.map(v => (
        <Card key={v.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: F.w700, color: C.navy }}>{v.therapist_name}</Text>
            <Text style={{ fontFamily: F.w700, color: v.overrun ? C.red : C.sub }}>{v.overrun ? 'Over time' : v.status.replace('_', ' ')}</Text>
          </View>
          <Text style={s.muted}>{fmtWhen(v.starts_at)}{v.zone_name ? ` · ${v.zone_name}` : ''}</Text>
          {v.lat != null && <Text accessibilityRole="link" onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`)} style={{ color: C.brand, fontFamily: F.w700 }}>Last location ›</Text>}
        </Card>
      ))}
    </Screen>
  );
}
