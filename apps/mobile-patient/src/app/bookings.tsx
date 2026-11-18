import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, ApiError, fmtDay, fmtTime, tokens } from '../lib/api';
import { F, Button, C, Card, ErrorText, Screen, s } from '../lib/ui';

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
            <Text style={{ color: C.green, fontFamily: F.w700, textTransform: 'capitalize' }}>{b.status}</Text>
          </View>
          <Text style={s.muted}>{b.therapist_name} · {b.mode}{b.sessions_total > 1 ? ` · ${b.sessions_total}-session plan` : ''}{b.zone_name ? ` · ${b.zone_name}` : ''}</Text>
          {b.payment_id && (
            <Text accessibilityRole="link" onPress={() => router.push({ pathname: '/payment/[id]', params: { id: b.payment_id! } })} style={{ color: C.brand, fontFamily: F.w700 }}>
              {b.payment_method === 'upi' ? 'UPI' : 'Cash'} · {({ pending: 'payment due', submitted: 'checking payment', paid: 'paid', rejected: 'payment needs attention' } as Record<string, string>)[b.payment_status ?? 'pending']} ›
            </Text>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {b.plan_id && <Text accessibilityRole="link" onPress={() => router.push({ pathname: '/chat/[planId]', params: { planId: b.plan_id! } })} style={{ color: C.brand, fontFamily: F.w700, paddingVertical: 8 }}>Message</Text>}
            {b.status === 'completed' && !b.rated && <Text accessibilityRole="link" onPress={() => router.push({ pathname: '/rate/[id]', params: { id: b.id } })} style={{ color: C.brand, fontFamily: F.w700, paddingVertical: 8 }}>Rate visit</Text>}
            {['completed', 'in_progress', 'booked', 'no_show'].includes(b.status) && <Text accessibilityRole="link" onPress={() => router.push({ pathname: '/report/[id]', params: { id: b.id } })} style={{ color: C.sub, fontFamily: F.w700, paddingVertical: 8, textDecorationLine: 'underline' }}>Report a problem</Text>}
          </View>
        </Card>
      ))}
      <Button title="My plans and refunds" variant="ghost" onPress={() => router.push('/plans')} />
      <Button title="Refer & coins" variant="ghost" onPress={() => router.push('/rewards')} />
      <Button title="Complaints & Grievance Officer" variant="ghost" onPress={() => router.push('/grievance')} />
      <Button title="Sign out" variant="ghost" onPress={async () => { await tokens.clear(); router.replace('/'); }} />
    </Screen>
  );
}
