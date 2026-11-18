import { useCallback, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError, fmtDay, fmtTime } from '../lib/api';
import { F, Button, C, Card, ErrorText, Screen, s } from '../lib/ui';

type Prefs = { push: boolean; sms: boolean; whatsapp: boolean; language: string };

// Inbox and how we contact you. Safety alerts and sign-in codes are always sent.
export default function Notifications() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.inbox>>['notifications'] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    api.inbox().then(r => { setItems(r.notifications); api.readAll().catch(() => undefined); }).catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t load.'));
    api.prefs().then(r => setPrefs(r.preferences)).catch(() => undefined);
  }, []));
  const row = (k: 'sms' | 'whatsapp', label: string) => prefs && (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
      <Text style={[s.sub, { flex: 1 }]}>{label}</Text>
      <Switch value={prefs[k]} onValueChange={v => { setPrefs({ ...prefs, [k]: v }); setSaved(false); }} trackColor={{ true: C.brand }} accessibilityLabel={label} />
    </View>
  );
  return (
    <Screen title="Notifications">
      <ErrorText error={error} />
      {prefs && (
        <Card>
          <Text style={s.h2}>How we contact you</Text>
          {row('sms', 'SMS for bookings, payments and arrivals')}
          {row('whatsapp', 'WhatsApp confirmations and reminders')}
          <Text style={s.muted}>App notifications are managed in your phone’s settings. Safety alerts are always sent.</Text>
          <Button title={saved ? 'Saved' : 'Save'} variant="ghost" onPress={() => api.savePrefs(prefs).then(() => setSaved(true)).catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t save.'))} />
        </Card>
      )}
      {items?.length === 0 && <Card><Text style={s.muted}>Nothing yet.</Text></Card>}
      {items?.map(n => (
        <Card key={n.id} highlight={!n.read_at}>
          <Text style={s.muted}>{fmtDay(n.created_at)} · {fmtTime(n.created_at)}</Text>
          <Text style={{ fontFamily: F.w700, color: C.navy, fontSize: 16 }}>{n.title}</Text>
          {n.body ? <Text style={s.sub}>{n.body}</Text> : null}
        </Card>
      ))}
    </Screen>
  );
}
