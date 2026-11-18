import { useCallback, useState } from 'react';
import { Linking, Share, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError, rupees } from '../lib/api';
import { Button, C, Card, ErrorText, Screen, s } from '../lib/ui';

const REASON: Record<string, string> = { welcome: 'Welcome bonus', referral: 'Friend’s first visit', redeem: 'Used on a booking', redeem_return: 'Booking cancelled, coins back', refund_return: 'Refund, coins back', adjust: 'From PhysioConnect' };

// Coin balance and history; share your referral link.
export default function Rewards() {
  const [w, setW] = useState<Awaited<ReturnType<typeof api.coins>> | null>(null);
  const [r, setR] = useState<Awaited<ReturnType<typeof api.referral>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    Promise.all([api.coins(), api.referral()]).then(([a, b]) => { setW(a); setR(b); }).catch(e => setError(e instanceof ApiError ? e.message : 'Something went wrong.'));
  }, []));
  return (
    <Screen title="Refer & coins" sub="10 coins = ₹1. Use coins on any booking.">
      <ErrorText error={error} />
      {w && (
        <Card highlight>
          <Text style={s.muted}>Your coins</Text>
          <Text style={{ fontSize: 36, fontWeight: '800', color: C.navy }}>{w.balance.toLocaleString('en-IN')}</Text>
          <Text style={s.muted}>Worth {rupees(w.rupeesPaise)}</Text>
        </Card>
      )}
      {r && (
        <Card>
          <Text style={s.h2}>Invite friends and family</Text>
          <Text style={s.muted}>They get {r.welcomeCoins} coins (₹{r.welcomeCoins / 10}) when they join. You get {r.referrerCoins} coins (₹{r.referrerCoins / 10}) when their first visit is paid.</Text>
          <View style={{ backgroundColor: C.bg, borderRadius: 12, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={s.muted}>Your code</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', letterSpacing: 2, color: C.navy }}>{r.code}</Text>
          </View>
          <Button title="Share invite" onPress={() => Share.share({ message: r.shareText })} />
          <Button title="Send on WhatsApp" variant="ghost" onPress={() => Linking.openURL(`whatsapp://send?text=${encodeURIComponent(r.shareText)}`).catch(() => Share.share({ message: r.shareText }))} />
          <Text style={s.muted}>{r.joined} joined with your link · {r.booked} booked a visit</Text>
        </Card>
      )}
      {w && (
        <Card>
          <Text style={s.h2}>History</Text>
          {w.entries.length === 0 && <Text style={s.muted}>No coins yet.</Text>}
          {w.entries.map(e => (
            <View key={e.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
              <Text style={{ color: C.navy, flex: 1 }}>{REASON[e.reason] ?? e.reason}</Text>
              <Text style={{ fontWeight: '800', color: e.delta > 0 ? C.green : C.navy }}>{e.delta > 0 ? '+' : ''}{e.delta}</Text>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
