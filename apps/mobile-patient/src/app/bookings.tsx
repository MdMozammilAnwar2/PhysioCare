import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, ApiError, fmtDay, fmtTime, tokens } from '../lib/api';
import { Button, C, Card, ErrorText, Screen, s } from '../lib/ui';

type Row = Awaited<ReturnType<typeof api.bookings>>['bookings'][number];

export default function Bookings() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    api.bookings().then(r => setRows(r.bookings)).catch(async e => {
      if (e instanceof ApiError && e.status === 401) { await tokens.clear(); router.replace('/'); return; }
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    });
  }, [router]));
  return (
    <Screen title="Bookings">
      <Button title="Book a visit" onPress={() => router.push('/where')} />
      <ErrorText error={error} />
      {rows?.length === 0 && <Card><Text style={s.h2}>No visits yet</Text><Text style={s.muted}>Find a verified physiotherapist near your home.</Text></Card>}
      {rows?.map(b => (
        <Card key={b.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={s.h2}>{fmtDay(b.starts_at)} · {fmtTime(b.starts_at)}</Text>
            <Text style={{ color: C.green, fontWeight: '700', textTransform: 'capitalize' }}>{b.status}</Text>
          </View>
          <Text style={s.muted}>{b.therapist_name} · {b.mode}{b.sessions_total > 1 ? ` · ${b.sessions_total}-session plan` : ''}{b.zone_name ? ` · ${b.zone_name}` : ''}</Text>
        </Card>
      ))}
      <Button title="Sign out" variant="ghost" onPress={async () => { await tokens.clear(); router.replace('/'); }} />
    </Screen>
  );
}
