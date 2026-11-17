import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError, fmtDay, rupees, type Wallet } from '../lib/api';
import { C, Card, ErrorText, Screen, s } from '../lib/ui';

const STATUS: Record<string, [string, string]> = {
  held: ['On hold', C.amber], available: ['Available', C.green], frozen: ['Frozen: report open', C.red],
  paid: ['Paid', C.sub], reversed: ['Reversed', C.red], in_payout: ['In this week’s payout', C.brand],
};

// Physio earnings: available, on hold (7 days after the visit), frozen by a report, paid; entries and payouts.
export default function WalletScreen() {
  const [w, setW] = useState<Wallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { api.wallet().then(setW).catch(e => setError(e instanceof ApiError ? e.message : 'Something went wrong.')); }, []));
  const tile = (label: string, paise: number, color: string = C.navy) => (
    <View style={{ flex: 1, minWidth: '45%', backgroundColor: C.white, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 14, gap: 4 }}>
      <Text style={s.muted}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: '800', color }}>{rupees(paise)}</Text>
    </View>
  );
  return (
    <Screen kicker="Your money" title="Earnings" sub="Earnings become available 7 days after a visit. We pay every week by bank or UPI.">
      <ErrorText error={error} />
      {w && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {tile('Available', w.availablePaise, C.green)}
            {tile('On hold', w.heldPaise, C.amber)}
            {tile('Paid to you', w.paidPaise)}
            {tile('TDS deducted', w.tdsThisYearPaise, C.sub)}
          </View>
          {w.frozenPaise > 0 && <Card><Text style={{ color: C.red, fontWeight: '700' }}>{rupees(w.frozenPaise)} frozen while a patient report is reviewed. Our team will contact you.</Text></Card>}

          <Text style={s.h2}>Payouts</Text>
          {w.payouts.length === 0 && <Text style={s.muted}>No payouts yet.</Text>}
          {w.payouts.map(p => (
            <Card key={p.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={s.h2}>{rupees(p.amount_paise)}</Text>
                <Text style={{ fontWeight: '700', color: p.status === 'paid' ? C.green : C.amber }}>{p.status === 'paid' ? 'Paid' : 'Being sent'}</Text>
              </View>
              <Text style={s.muted}>{p.status === 'paid' && p.paid_at ? `${fmtDay(p.paid_at)} · ${p.method?.toUpperCase()} · Ref ${p.reference}` : `Created ${fmtDay(p.created_at)}`}{p.tds_paise ? ` · TDS ${rupees(p.tds_paise)}` : ''}</Text>
            </Card>
          ))}

          <Text style={s.h2}>Visits</Text>
          {w.entries.length === 0 && <Text style={s.muted}>Earnings appear here after a completed visit is paid.</Text>}
          {w.entries.map(e => {
            const [label, color] = STATUS[e.status] ?? [e.status, C.sub];
            return (
              <Card key={e.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700', color: C.navy }}>{fmtDay(e.visit_at)} · {e.patient_name ?? 'Patient'}</Text>
                  <Text style={{ fontWeight: '800', color: C.navy }}>{rupees(e.net_paise)}</Text>
                </View>
                <Text style={s.muted}>Price {rupees(e.gross_paise)} − fee {rupees(e.fee_paise)} − TDS {rupees(e.tds_paise)}</Text>
                <Text style={{ fontWeight: '700', color }}>{label}{e.status === 'held' ? ` until ${fmtDay(e.available_at)}` : ''}</Text>
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}
