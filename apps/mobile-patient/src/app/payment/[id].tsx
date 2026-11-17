import { useCallback, useState } from 'react';
import { Image, Linking, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError, rupees, type Payment } from '../../lib/api';
import { Button, C, Card, ErrorText, Field, Screen, s } from '../../lib/ui';

const LABEL = { pending: 'Waiting for payment', submitted: 'Checking your payment', paid: 'Paid', rejected: 'Needs attention' } as const;

// QR + reference, then UTR and/or screenshot. Status updates when ops verifies.
export default function PaymentScreen() {
  const router = useRouter();
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const [p, setP] = useState<Payment | null>(null);
  const [utr, setUtr] = useState('');
  const [shot, setShot] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.payment(String(id)).then(r => setP(r.payment)).catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t load the payment.')); }, [id]);
  useFocusEffect(load);

  async function pick() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    setShot({ uri: a.uri, name: a.fileName ?? 'payment.jpg', type: a.mimeType ?? 'image/jpeg' });
  }
  async function submit() {
    if (!utr.trim() && !shot) return setError('Add the UPI reference number or the screenshot.');
    setError(null); setBusy(true);
    try {
      const file = shot ? await api.upload(shot, 'payment_proof') : null;
      await api.upiProof(String(id), { utr: utr.trim() || undefined, fileId: file?.id });
      load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  }

  if (!p) return <Screen title="Payment"><ErrorText error={error} />{!error && <Text style={s.muted}>Loading…</Text>}</Screen>;
  return (
    <Screen kicker={isNew ? 'You’re booked' : 'Payment'} title={`${rupees(p.amountPaise)} · ${LABEL[p.status]}`} sub={`Reference ${p.reference}`}>
      {p.status === 'paid' && <Card><Text style={{ color: C.green, fontWeight: '700' }}>Payment confirmed. Invoice {p.invoiceNo}.</Text></Card>}
      {p.status === 'rejected' && <Card><Text style={{ color: C.red, fontWeight: '700' }}>We couldn’t confirm this payment.</Text><Text style={s.muted}>{p.reviewNote}</Text></Card>}
      {p.method === 'cash' && p.status !== 'paid' && <Card><Text style={s.h2}>Pay {rupees(p.amountPaise)} in cash to your physio at the visit.</Text><Text style={s.muted}>They’ll mark it received; your receipt appears here once we confirm it.</Text></Card>}
      {p.method === 'upi' && (p.status === 'pending' || p.status === 'rejected') && (
        <>
          <Card>
            <Text style={s.h2}>1 · Scan and pay</Text>
            {p.qrUrl && <View style={{ alignItems: 'center' }}><Image source={api.imageSource(p.qrUrl)} style={{ width: 240, height: 240 }} accessibilityLabel={`UPI QR code to pay ${rupees(p.amountPaise)}`} /></View>}
            <Text style={s.body}>Pay <Text style={{ fontWeight: '700' }}>{rupees(p.amountPaise)}</Text> to <Text style={{ fontWeight: '700' }}>{p.upiId}</Text> ({p.payeeName})</Text>
            <Text style={s.muted}>Write {p.reference} in the payment note.</Text>
            {p.upiUri && <Button title="Open my UPI app" variant="ghost" onPress={() => Linking.openURL(p.upiUri!).catch(() => setError('No UPI app found. Scan the QR from another phone.'))} />}
          </Card>
          <Card>
            <Text style={s.h2}>2 · Send us the proof</Text>
            <Field label="UPI reference number (UTR, 12 digits)" value={utr} onChangeText={t => setUtr(t.replace(/[^A-Za-z0-9]/g, '').slice(0, 32))} keyboardType="number-pad" />
            <Button title={shot ? `Screenshot added · ${shot.name}` : 'Add payment screenshot'} variant="ghost" onPress={pick} />
            <ErrorText error={error} />
            <Button title="Submit payment details" onPress={submit} busy={busy} />
          </Card>
        </>
      )}
      {p.status === 'submitted' && <Card><Text style={s.h2}>Thanks! We’re checking your payment.</Text><Text style={s.muted}>You’ll get a notification when it’s confirmed.</Text></Card>}
      <Button title="My bookings" variant="ghost" onPress={() => router.replace('/bookings')} />
    </Screen>
  );
}
