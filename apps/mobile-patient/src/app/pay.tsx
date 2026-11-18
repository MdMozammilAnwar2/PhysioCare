import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { api, ApiError, draft, fmtDay, fmtTime, rupees } from '../lib/api';
import { F, Button, C, Card, Check, ErrorText, Screen, s } from '../lib/ui';

// Patient picks Cash or UPI; the booking is confirmed here.
export default function Pay() {
  const router = useRouter();
  const [method, setMethod] = useState<'upi' | 'cash'>('upi');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coins, setCoins] = useState<{ coins: number; discountPaise: number; maxPct: number } | null>(null);
  const [useCoins, setUseCoins] = useState(true);
  const h = draft.hold;
  useEffect(() => { if (h) api.coinCheckout(h.amountPaise).then(setCoins).catch(() => undefined); }, [h?.amountPaise]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!h) return <Redirect href="/bookings" />;

  async function confirm() {
    setError(null); setBusy(true);
    try {
      const r = await api.confirm(h!.visitId, method, useCoins && Boolean(coins?.coins));
      draft.hold = undefined;
      router.replace({ pathname: '/payment/[id]', params: { id: r.payment.id, new: '1' } });
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  }
  const Option = ({ value, title, sub }: { value: 'upi' | 'cash'; title: string; sub: string }) => (
    <Pressable onPress={() => setMethod(value)} accessibilityRole="radio" accessibilityState={{ selected: method === value }}
      style={{ padding: 14, borderRadius: 16, borderWidth: method === value ? 2 : 1, borderColor: method === value ? C.brand : C.line, backgroundColor: method === value ? C.soft : C.white, gap: 4 }}>
      <Text style={{ fontFamily: F.w700, fontSize: 16, color: C.navy }}>{title}</Text>
      <Text style={s.muted}>{sub}</Text>
    </Pressable>
  );
  return (
    <Screen kicker="Almost done" title="How will you pay?" sub={`${draft.therapistName} · ${fmtDay(h.start)} · ${fmtTime(h.start)} · ${rupees(h.amountPaise - (useCoins && coins?.coins ? coins.discountPaise : 0))}`}>
      <Card>
        {coins && coins.coins > 0 && <Check label={`Use ${coins.coins} coins · save ${rupees(coins.discountPaise)} (up to ${coins.maxPct}% of a booking)`} value={useCoins} onChange={setUseCoins} />}
        <View style={{ gap: 10 }}>
          <Option value="upi" title="UPI · scan our QR" sub="Google Pay, PhonePe, Paytm or any UPI app. Upload the screenshot after paying." />
          <Option value="cash" title="Cash at the visit" sub="Pay your physio. Your receipt appears once we confirm it." />
        </View>
        <ErrorText error={error} />
        <Button title="Confirm booking" variant="dark" onPress={confirm} busy={busy} />
      </Card>
    </Screen>
  );
}
