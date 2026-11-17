import { Text } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { draft, fmtDay, fmtTime, rupees } from '../lib/api';
import { Button, Card, Screen, s } from '../lib/ui';

export default function Done() {
  const router = useRouter();
  const d = draft.done;
  if (!d) return <Redirect href="/bookings" />;
  return (
    <Screen kicker="Booking confirmed" title="You’re booked" sub={`Payment of ${rupees(d.amountPaise)} received. Invoice ${d.invoiceNo}.`}>
      <Card>
        <Text style={s.body}>Physio: <Text style={{ fontWeight: '700' }}>{draft.therapistName}</Text></Text>
        <Text style={s.body}>First visit: <Text style={{ fontWeight: '700' }}>{fmtDay(d.start)} · {fmtTime(d.start)}</Text></Text>
        <Text style={s.muted}>On the day you’ll get a 4-digit check-in code. Share it only when your physio arrives.</Text>
        <Button title="My bookings" onPress={() => { draft.done = undefined; router.replace('/bookings'); }} />
      </Card>
    </Screen>
  );
}
