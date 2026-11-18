import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, ApiError } from '../lib/api';
import { F, Button, C, Card, ErrorText, Field, Screen, s } from '../lib/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const valid = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

// Simple weekly hours: pick days, a morning and an evening block; prices for home and video.
export default function Hours() {
  const router = useRouter();
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [am, setAm] = useState({ start: '07:00', end: '13:00' });
  const [pm, setPm] = useState({ start: '16:00', end: '19:00' });
  const [home, setHome] = useState('');
  const [video, setVideo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.availability().then(r => {
      if (!r.rules.length) return;
      setDays([...new Set(r.rules.map(x => x.weekday))]);
      const first = r.rules.filter(x => x.weekday === r.rules[0].weekday);
      if (first[0]) setAm({ start: first[0].start, end: first[0].end });
      if (first[1]) setPm({ start: first[1].start, end: first[1].end });
    }).catch(() => undefined);
  }, []);

  async function save() {
    if (![am.start, am.end, pm.start, pm.end].every(valid)) return setError('Use 24-hour times like 07:00 and 19:00.');
    if (!(Number(home) > 0)) return setError('Set your home-visit price.');
    setError(null); setBusy(true);
    try {
      const blocks = [am, pm].filter(b => b.end > b.start);
      await api.saveAvailability(days.flatMap(weekday => blocks.map(b => ({ weekday, start: b.start, end: b.end, modes: ['home', 'video'] }))));
      const prices = [{ mode: 'home', pricePaise: Math.round(Number(home) * 100) }];
      if (Number(video) > 0) prices.push({ mode: 'video', pricePaise: Math.round(Number(video) * 100) });
      await api.savePrices(prices);
      router.replace('/schedule');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  }
  return (
    <Screen title="Hours & prices">
      <Card>
        <Text style={s.h2}>Working days</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {DAYS.map((d, i) => {
            const on = days.includes(i);
            return (
              <Pressable key={d} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setDays(on ? days.filter(x => x !== i) : [...days, i])}
                style={[s.chip, { minWidth: 52, alignItems: 'center' }, on ? { backgroundColor: C.navy } : { backgroundColor: C.white, borderWidth: 1, borderColor: C.line }]}>
                <Text style={{ color: on ? C.white : C.navy, fontFamily: F.w700 }}>{d}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={s.label}>Morning</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="From" value={am.start} onChangeText={t => setAm(x => ({ ...x, start: t }))} /></View>
          <View style={{ flex: 1 }}><Field label="To" value={am.end} onChangeText={t => setAm(x => ({ ...x, end: t }))} /></View>
        </View>
        <Text style={s.label}>Evening (leave both the same to skip)</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="From" value={pm.start} onChangeText={t => setPm(x => ({ ...x, start: t }))} /></View>
          <View style={{ flex: 1 }}><Field label="To" value={pm.end} onChangeText={t => setPm(x => ({ ...x, end: t }))} /></View>
        </View>
      </Card>
      <Card>
        <Text style={s.h2}>Prices per session (₹)</Text>
        <Field label="Home visit · 45 min" value={home} onChangeText={t => setHome(t.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Field label="Video · 30 min (optional)" value={video} onChangeText={t => setVideo(t.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Text style={s.muted}>You receive the price minus the platform fee and TDS.</Text>
      </Card>
      <ErrorText error={error} />
      <Button title="Save" onPress={save} busy={busy} disabled={days.length === 0} />
    </Screen>
  );
}
