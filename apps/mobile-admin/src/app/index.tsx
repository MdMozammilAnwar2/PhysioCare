import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { api, ApiError, rupees, STAFF, tokens, type Dashboard, type User } from '../lib/api';
import { F, Button, C, s } from '../lib/ui';
import { Logo } from '../lib/logo';

// Home: what needs attention now. SOS first, then queues, today, money and growth.
export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      const u = await api.me();
      if (!u.roles.some(r => STAFF.includes(r))) { await api.logout(); setReady(false); return; }
      setUser(u); setD(await api.dashboard());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await tokens.clear(); setReady(false); return; }
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  }, []);
  useFocusEffect(useCallback(() => { tokens.load().then(ok => { setReady(ok); if (ok) load(); }); }, [load]));
  if (ready === null) return null;
  if (!ready) return <Redirect href="/signin" />;
  const has = (...r: string[]) => user?.roles.some(x => r.includes(x));
  const Tile = ({ label, value, alert, onPress }: { label: string; value: string | number; alert?: boolean; onPress?: () => void }) => (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: alert ? '#FFE4E8' : C.white, borderRadius: 16, borderWidth: 1, borderColor: alert ? '#FDA4AF' : C.line, padding: 14, gap: 2 }}>
      <Text style={[s.muted, alert && { color: C.red }]}>{label}</Text>
      <Text style={{ fontSize: 24, fontFamily: F.w800, color: alert ? C.red : C.navy }}>{value}</Text>
    </Pressable>
  );
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={{ gap: 8 }}><Text style={s.h2}>{title}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{children}</View></View>
  );
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingTop: 56, gap: 18 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Logo size={30} suffix="Admin" />
        <Text accessibilityRole="button" onPress={async () => { await api.logout(); router.replace('/signin'); }} style={{ color: C.sub, fontFamily: F.w700 }}>Sign out</Text>
      </View>
      {user && <Text style={s.muted}>{user.name ?? user.phone} · {user.primaryRole.replace('_', ' ')}</Text>}
      {error && <Text style={{ color: C.red, fontFamily: F.w600 }}>{error}</Text>}
      {d && d.queues.sos > 0 && (
        <Pressable onPress={() => router.push('/live')} accessibilityRole="button" style={{ backgroundColor: '#E11D48', borderRadius: 16, padding: 16 }}>
          <Text style={{ color: '#fff', fontFamily: F.w800, fontSize: 18 }}>🚨 {d.queues.sos} SOS open — tap to respond</Text>
        </Pressable>
      )}
      {d && (
        <>
          <Section title="Needs action">
            {has('ops_admin', 'super_admin', 'finance') && <Tile label="Payments to confirm" value={d.queues.payments} onPress={() => router.push('/approvals')} />}
            {has('ops_admin', 'super_admin', 'city_coordinator') && <Tile label="Partners to review" value={d.queues.partners} onPress={() => router.push('/approvals')} />}
            {has('ops_admin', 'super_admin', 'finance') && <Tile label="Refunds" value={d.queues.refunds} onPress={() => router.push('/approvals')} />}
            {has('ops_admin', 'super_admin') && <Tile label="Open incidents" value={d.queues.incidents} alert={d.queues.incidents > 0} />}
            {has('ops_admin', 'super_admin', 'city_coordinator') && <Tile label="Physios to verify" value={d.queues.verifications} />}
            {has('grievance_committee', 'ops_admin', 'super_admin') && <Tile label="Grievances overdue" value={d.queues.grievances_overdue} alert={d.queues.grievances_overdue > 0} />}
          </Section>
          <Section title="Today">
            <Tile label="Visits" value={d.today.visits} onPress={() => router.push('/live')} />
            <Tile label="In progress" value={d.today.live} onPress={() => router.push('/live')} />
            <Tile label="Completed" value={d.today.completed} />
            <Tile label="Cancelled / no-show" value={d.today.lost} />
          </Section>
          {has('finance', 'super_admin') && (
            <Section title="Money">
              <Tile label="Collected, 7 days" value={rupees(d.money.collected_7d)} />
              <Tile label="Not yet paid" value={rupees(d.money.outstanding)} />
              <Tile label="Physio payouts due" value={rupees(d.money.payouts_due)} />
              <Tile label="Refunds to send" value={rupees(d.money.refunds_due)} />
            </Section>
          )}
          <Section title="Growth">
            <Tile label="Sign-ups today" value={d.growth.signups_today} />
            <Tile label="Sign-ups, 7 days" value={d.growth.signups_7d} />
            <Tile label="Verified physios" value={d.growth.physios_verified} />
            <Tile label="Active partners" value={d.growth.partners_active} />
          </Section>
        </>
      )}
      <View style={{ gap: 10 }}>
        <Button title="Live visits & SOS" onPress={() => router.push('/live')} />
        <Button title="Approvals" variant="ghost" onPress={() => router.push('/approvals')} />
      </View>
      <Text style={[s.muted, { textAlign: 'center' }]}>Everything else is in the web console.</Text>
    </ScrollView>
  );
}
