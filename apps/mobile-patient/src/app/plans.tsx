import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, ApiError, rupees } from '../lib/api';
import { F, Button, C, Card, ErrorText, Field, Screen, s } from '../lib/ui';

type Plan = Awaited<ReturnType<typeof api.plans>>['plans'][number];
type Refund = Awaited<ReturnType<typeof api.refunds>>['refunds'][number];
const REFUND_STATUS: Record<string, string> = { requested: 'Refund requested', approved: 'Refund approved, sending soon', paid: 'Refund sent', rejected: 'Refund not approved' };

export default function Plans() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [est, setEst] = useState<{ planId: string; unused: number; amountPaise: number } | null>(null);
  const [refundTo, setRefundTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Something went wrong.');
  const load = useCallback(() => { Promise.all([api.plans(), api.refunds()]).then(([p, r]) => { setPlans(p.plans); setRefunds(r.refunds); }).catch(fail); }, []);
  useFocusEffect(load);

  async function request() {
    if (!est) return; setError(null);
    try { await api.requestRefund(est.planId, refundTo.trim()); setEst(null); setRefundTo(''); load(); } catch (e) { fail(e); }
  }
  return (
    <Screen title="My plans">
      <ErrorText error={error} />
      {est && (
        <Card highlight>
          <Text style={s.h2}>Refund {est.unused} unused session{est.unused === 1 ? '' : 's'}: {rupees(est.amountPaise)}</Text>
          <Text style={s.muted}>Future visits in this plan will be cancelled. We send the money within 7 working days of approval.</Text>
          <Field label="Send to (UPI ID, or bank account + IFSC)" value={refundTo} onChangeText={setRefundTo} autoCapitalize="none" />
          <Button title="Request refund" disabled={refundTo.trim().length < 5 || est.amountPaise <= 0} onPress={request} />
          <Button title="Cancel" variant="ghost" onPress={() => setEst(null)} />
        </Card>
      )}
      {plans?.length === 0 && <Card><Text style={s.h2}>No plans yet</Text></Card>}
      {plans?.map(p => {
        const r = refunds.find(x => x.plan_id === p.id);
        const canRefund = p.status === 'active' && p.payment_status === 'paid' && p.completed < p.sessions_total && (!r || r.status === 'rejected');
        return (
          <Card key={p.id}>
            <Text style={s.h2}>{p.therapist_name} · {p.sessions_total}-session plan</Text>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: C.bg, overflow: 'hidden' }}><View style={{ height: 8, width: `${(100 * p.completed) / p.sessions_total}%`, backgroundColor: C.brand }} /></View>
            <Text style={s.muted}>{p.completed} of {p.sessions_total} done · {rupees(p.price_paise)} · {p.status}</Text>
            {r && <Text style={{ fontFamily: F.w700, color: C.navy }}>{REFUND_STATUS[r.status] ?? r.status} · {rupees(r.amount_paise)}{r.note ? ` · ${r.note}` : ''}</Text>}
            <Button title="Message physio" variant="ghost" onPress={() => router.push({ pathname: '/chat/[planId]', params: { planId: p.id } })} />
            {canRefund && <Text accessibilityRole="link" onPress={() => api.refundEstimate(p.id).then(setEst).catch(fail)} style={{ color: C.sub, fontFamily: F.w700, textDecorationLine: 'underline' }}>Refund unused sessions</Text>}
          </Card>
        );
      })}
    </Screen>
  );
}
