import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { sendSos } from '../lib/sos';
import { api, ApiError, fmtDay, fmtTime, tokens, visitsCache, type Visit } from '../lib/api';
import { Button, C, Card, ErrorText, Screen, ZonePill, s } from '../lib/ui';

const STATUS: Record<string, [string, string]> = { booked: ['Booked', C.sub], on_the_way: ['On the way', C.brand], checked_in: ['In session', C.green], completed: ['Done', C.green], cancelled: ['Cancelled', C.red], no_show: ['No-show', C.red] };

export default function Schedule() {
  const router = useRouter();
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.visits().then(r => { visitsCache.list = r.visits; setVisits(r.visits); }).catch(async e => {
      if (e instanceof ApiError && e.status === 401) { await tokens.clear(); router.replace('/'); return; }
      setError(e instanceof ApiError ? e.message : 'Couldn’t load visits.');
    });
  }, [router]);
  useFocusEffect(load);

  async function consent(v: Visit, accept: boolean) {
    try { await api.consent(v.id, accept); load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); }
  }
  const pending = visits?.filter(v => v.physio_consent === 'pending') ?? [];
  const upcoming = visits?.filter(v => v.physio_consent !== 'pending' && !['cancelled'].includes(v.status)) ?? [];
  return (
    <Screen title="Schedule">
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button title="Hours & prices" variant="ghost" onPress={() => router.push('/hours')} /></View>
        <View style={{ flex: 1 }}><Button title="Refresh" variant="ghost" onPress={load} /></View>
      </View>
      <ErrorText error={error} />
      {pending.map(v => (
        <Card key={v.id} highlight>
          <Text style={s.kicker}>NEEDS YOUR CONSENT</Text>
          <Text style={s.h2}>Woman patient · family present</Text>
          <Text style={s.body}>{fmtDay(v.starts_at)} · {fmtTime(v.starts_at)}{v.zone_name ? ` · ${v.zone_name}` : ''}</Text>
          <Text style={s.muted}>{v.family_member ? `${v.family_member.relation} (${v.family_member.name}) will be at home for every visit.` : ''} Name and address appear after you accept. Declining never affects your ranking.</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button title="Decline" variant="ghost" onPress={() => consent(v, false)} /></View>
            <View style={{ flex: 2 }}><Button title="Agree & accept" onPress={() => consent(v, true)} /></View>
          </View>
        </Card>
      ))}
      {visits === null && !error && <Text style={s.muted}>Loading…</Text>}
      {visits?.length === 0 && <Card><Text style={s.h2}>No visits yet</Text><Text style={s.muted}>Make sure your hours and prices are set.</Text></Card>}
      {upcoming.map(v => {
        const [label, color] = STATUS[v.status] ?? [v.status, C.sub];
        return (
          <Pressable key={v.id} onPress={() => router.push({ pathname: '/visit/[id]', params: { id: v.id } })} accessibilityRole="button">
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={s.h2}>{fmtDay(v.starts_at)} · {fmtTime(v.starts_at)}</Text>
                <Text style={{ color, fontWeight: '700' }}>{label}</Text>
              </View>
              <Text style={s.body}>{v.patient_name ?? 'Patient'} · {v.mode}{v.sessions_total && v.sessions_total > 1 ? ` · ${v.sessions_total}-session plan` : ''}</Text>
              {v.zone_color ? <ZonePill color={v.zone_color} name={v.zone_name} /> : null}
            </Card>
          </Pressable>
        );
      })}
      <Pressable accessibilityRole="button" accessibilityLabel="SOS. Alerts our safety team" onLongPress={() => sendSos().catch(e => setError(e instanceof ApiError ? e.message : 'SOS failed. Call 112.'))} delayLongPress={1500}
        style={{ backgroundColor: '#F43F5E', borderRadius: 16, minHeight: 56, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>Hold for SOS</Text>
      </Pressable>
      <Button title="Sign out" variant="ghost" onPress={async () => { await tokens.clear(); router.replace('/'); }} />
    </Screen>
  );
}
