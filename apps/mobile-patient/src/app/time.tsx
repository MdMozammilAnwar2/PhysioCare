import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { api, ApiError, draft, fmtDay, fmtTime, istYmd, rupees } from '../lib/api';
import { Button, C, Card, Check, ErrorText, Field, Screen, s } from '../lib/ui';

type Pkg = { id: string; name: string; mode: string; sessions: number; price_paise: number };

export default function Time() {
  const router = useRouter();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => istYmd(new Date(Date.now() + i * 864e5))), []);
  const [day, setDay] = useState(days[0]);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [plan, setPlan] = useState('single');
  const [fm, setFm] = useState({ name: '', relation: '' });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tid = draft.therapistId;

  useEffect(() => {
    if (!tid) return;
    api.therapist(tid).then(r => { setPackages(r.therapist.packages.filter(p => p.mode === draft.mode)); setPrice(r.therapist.prices.find(p => p.mode === draft.mode)?.price_paise ?? null); }).catch(() => setError('Couldn’t load prices.'));
  }, [tid]);
  useEffect(() => {
    if (!tid) return;
    setSlots(null); setSlot(null);
    const q: Record<string, string> = { mode: draft.mode ?? 'home', from: day, days: '1' };
    if (draft.addressId) q.addressId = draft.addressId;
    api.slots(tid, q).then(r => setSlots(r.slots)).catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t load times.'));
  }, [day, tid]);
  if (!tid) return <Redirect href="/where" />;
  const amount = plan === 'single' ? price ?? 0 : packages.find(p => p.id === plan)?.price_paise ?? 0;

  async function pay() {
    if (!slot) return setError('Pick a time.');
    if (draft.requiresConsent && (!fm.name || !fm.relation || !consent)) return setError('Add who will be at home and give your consent.');
    setError(null); setBusy(true);
    try {
      const hold = await api.hold({ therapistId: tid, start: slot, mode: draft.mode, addressId: draft.addressId, packageId: plan === 'single' ? undefined : plan, familyMember: draft.requiresConsent ? fm : undefined });
      if (hold.payment.provider !== 'fake') {
        // Native Razorpay checkout needs a development build (react-native-razorpay); planned before launch.
        throw new ApiError(0, 'payment_unavailable', 'Payment in the app is coming soon. Please complete this booking on the website.');
      }
      const done = await api.simulatePayment(hold.payment.orderId);
      draft.done = { invoiceNo: done.invoiceNo, start: slot, amountPaise: hold.amountPaise };
      router.replace('/done');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  }

  return (
    <Screen kicker="Step 4 of 4" title={`Book ${draft.therapistName}`}>
      <Card>
        <Text style={s.h2}>Pick a day and time</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {days.map(d => (
            <Pressable key={d} onPress={() => setDay(d)} accessibilityRole="button" accessibilityState={{ selected: d === day }}
              style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', backgroundColor: d === day ? C.navy : C.white, borderWidth: 1, borderColor: C.line }}>
              <Text style={{ color: d === day ? C.white : C.navy, fontWeight: '700' }}>{fmtDay(`${d}T12:00:00+05:30`)}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {slots === null ? <Text style={s.muted}>Loading times…</Text> : slots.length === 0 ? <Text style={s.muted}>No free times this day.</Text> : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {slots.map(t => (
              <Pressable key={t} onPress={() => setSlot(t)} accessibilityRole="button" accessibilityState={{ selected: t === slot }}
                style={{ minHeight: 44, minWidth: 92, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t === slot ? C.brand : C.white, borderWidth: 1, borderColor: C.line }}>
                <Text style={{ color: t === slot ? C.white : C.navy, fontWeight: '700' }}>{fmtTime(t)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Card>
      <Card>
        <Text style={s.h2}>Choose a plan</Text>
        {price !== null && <PlanRow on={plan === 'single'} onPress={() => setPlan('single')} title="Single session" sub="Pay as you go" price={price} />}
        {packages.map(p => <PlanRow key={p.id} on={plan === p.id} onPress={() => setPlan(p.id)} title={p.name} sub={`${p.sessions} sessions`} price={p.price_paise} />)}
      </Card>
      {draft.requiresConsent && (
        <Card>
          <Text style={s.h2}>Who will be at home?</Text>
          <Text style={s.muted}>A male physio visits a woman only when an adult family member is present. He will be asked to agree too.</Text>
          <Field label="Family member’s name" value={fm.name} onChangeText={t => setFm(x => ({ ...x, name: t }))} />
          <Field label="Relationship" value={fm.relation} onChangeText={t => setFm(x => ({ ...x, relation: t }))} placeholder="e.g. Husband" />
          <Check label="I consent to a male physiotherapist treating me with my family member present." value={consent} onChange={setConsent} />
        </Card>
      )}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={s.h2}>Total</Text><Text style={[s.h2, { fontWeight: '800' }]}>{rupees(amount)}</Text></View>
        <ErrorText error={error} />
        <Button title={`Pay ${rupees(amount)}`} variant="dark" onPress={pay} busy={busy} disabled={!slot} />
        <Text style={s.muted}>Your slot is held for 10 minutes. Each visit is protected for 7 days.</Text>
      </Card>
    </Screen>
  );
}

const PlanRow = ({ on, onPress, title, sub, price }: { on: boolean; onPress: () => void; title: string; sub: string; price: number }) => (
  <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}
    style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 16, borderWidth: on ? 2 : 1, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.soft : C.white }}>
    <View><Text style={{ fontWeight: '700', color: C.navy, fontSize: 16 }}>{title}</Text><Text style={s.muted}>{sub}</Text></View>
    <Text style={{ fontWeight: '800', fontSize: 18, color: C.navy }}>{rupees(price)}</Text>
  </Pressable>
);
