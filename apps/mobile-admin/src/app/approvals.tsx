import { useCallback, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError, fmtWhen, rupees, type Partner, type Payment, type Refund } from '../lib/api';
import { F, Button, C, Card, ErrorText, Screen, s } from '../lib/ui';

const TYPE: Record<string, string> = { doctor: 'Doctor', hospital: 'Hospital', clinic: 'Clinic', pathology_lab: 'Pathology lab', physiotherapist: 'Physiotherapist', pharmacy: 'Pharmacy', gym: 'Gym', other: 'Other' };

// Quick decisions on the go: payments to confirm, partners to approve, refunds to approve. Your role decides what you see.
export default function Approvals() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [refunds, setRefunds] = useState<Refund[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api.payments().then(r => setPayments(r.payments)).catch(() => setPayments(null));
    api.partners().then(r => setPartners(r.partners)).catch(() => setPartners(null));
    api.refunds().then(r => setRefunds(r.refunds)).catch(() => setRefunds(null));
  }, []);
  useFocusEffect(load);
  const act = (fn: () => Promise<unknown>) => fn().then(load).catch(e => setError(e instanceof ApiError ? e.message : 'Failed.'));
  const reject = (what: string, fn: (note: string) => Promise<unknown>) => Platform.OS === 'ios'
    ? Alert.prompt(`Reject ${what}?`, 'Give a reason (they will see it).', note => note?.trim() && act(() => fn(note.trim())))
    : Alert.alert(`Reject ${what}?`, 'They will be told it was not approved.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reject', style: 'destructive', onPress: () => act(() => fn('Not approved. Please contact PhysioCare.')) }]);
  const Row = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>;
  const none = payments === null && partners === null && refunds === null;
  return (
    <Screen kicker="On the go" title="Approvals">
      <ErrorText error={error} />
      {none && <Card><Text style={s.muted}>Nothing here for your role.</Text></Card>}
      {payments && (
        <>
          <Text style={s.h2}>Payments to confirm ({payments.length})</Text>
          {payments.length === 0 && <Text style={s.muted}>All caught up.</Text>}
          {payments.map(p => (
            <Card key={p.id}>
              <Text style={{ fontFamily: F.w800, fontSize: 18, color: C.navy }}>{rupees(p.amount_paise)} · {p.method.toUpperCase()}</Text>
              <Text style={s.muted}>{p.patient_name ?? 'Patient'} → {p.therapist_name ?? 'Physio'} · {p.reference}{p.utr ? ` · UTR ${p.utr}` : ''}</Text>
              <Text style={s.muted}>Sent {fmtWhen(p.submitted_at)}{p.method === 'upi' ? ' · check the screenshot in the web console if needed' : ''}</Text>
              <Row>
                <View style={{ flex: 1 }}><Button title="Reject" variant="ghost" onPress={() => reject('this payment', n => api.reviewPayment(p.id, false, n))} /></View>
                <View style={{ flex: 1 }}><Button title="Confirm" onPress={() => act(() => api.reviewPayment(p.id, true))} /></View>
              </Row>
            </Card>
          ))}
        </>
      )}
      {partners && (
        <>
          <Text style={s.h2}>Partners to review ({partners.length})</Text>
          {partners.length === 0 && <Text style={s.muted}>All caught up.</Text>}
          {partners.map(p => (
            <Card key={p.id}>
              <Text style={{ fontFamily: F.w800, fontSize: 17, color: C.navy }}>{p.name}</Text>
              <Text style={s.muted}>{TYPE[p.type] ?? p.type} · {p.contact_name ?? ''} {p.phone ?? ''} · applied {fmtWhen(p.created_at)}</Text>
              <Row>
                <View style={{ flex: 1 }}><Button title="Reject" variant="ghost" onPress={() => reject('this partner', n => api.decidePartner(p.id, false, n))} /></View>
                <View style={{ flex: 1 }}><Button title="Approve" onPress={() => act(() => api.decidePartner(p.id, true))} /></View>
              </Row>
            </Card>
          ))}
        </>
      )}
      {refunds && (
        <>
          <Text style={s.h2}>Refunds requested ({refunds.length})</Text>
          {refunds.length === 0 && <Text style={s.muted}>All caught up.</Text>}
          {refunds.map(r => (
            <Card key={r.id}>
              <Text style={{ fontFamily: F.w800, fontSize: 18, color: C.navy }}>{rupees(r.amount_paise)}</Text>
              <Text style={s.muted}>{r.patient_name ?? 'Patient'} · {r.reason === 'unused_sessions' ? 'Unused sessions' : 'Incident'} · {fmtWhen(r.created_at)}</Text>
              <Row>
                <View style={{ flex: 1 }}><Button title="Reject" variant="ghost" onPress={() => reject('this refund', n => api.decideRefund(r.id, false, n))} /></View>
                <View style={{ flex: 1 }}><Button title="Approve" onPress={() => act(() => api.decideRefund(r.id, true))} /></View>
              </Row>
            </Card>
          ))}
        </>
      )}
      <Text style={[s.muted, { textAlign: 'center' }]}>Refund transfers and partner payouts are recorded in the web console.</Text>
    </Screen>
  );
}
