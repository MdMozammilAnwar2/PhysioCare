import { useCallback, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '../lib/api';
import { F, Button, C, Card, Chips, ErrorText, Screen, s } from '../lib/ui';

const CAT: [string, string][] = [['service', 'Service'], ['physio_conduct', 'Physio’s behaviour'], ['safety', 'Safety'], ['harassment', 'Harassment'], ['payment', 'Payment'], ['refund', 'Refund'], ['privacy', 'Privacy'], ['app', 'App'], ['other', 'Other']];
const STATUS: Record<string, string> = { open: 'Received', acknowledged: 'Acknowledged', in_review: 'Being looked into', resolved: 'Resolved', rejected: 'Closed' };

// Grievance Officer details and complaints (IT Rules 2021).
export default function Grievance() {
  const [o, setO] = useState<Awaited<ReturnType<typeof api.grievanceOfficer>>['officer'] | null>(null);
  const [mine, setMine] = useState<Awaited<ReturnType<typeof api.myGrievances>>['grievances']>([]);
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.grievanceOfficer().then(r => setO(r.officer)).catch(() => undefined);
    api.myGrievances().then(r => setMine(r.grievances)).catch(() => undefined);
  }, []);
  useFocusEffect(load);
  async function submit() {
    setBusy(true); setError(null);
    try { const r = await api.fileGrievance({ category, description: text.trim() }); setDone(r.grievance.ticket_no); setText(''); setCategory(''); load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  }
  return (
    <Screen kicker="Grievance redressal" title="Complaints" sub="For emergencies call 112.">
      {o && (
        <Card>
          <Text style={s.muted}>{o.designation}</Text>
          <Text style={s.h2}>{o.name}</Text>
          {o.email && <Text accessibilityRole="link" onPress={() => Linking.openURL(`mailto:${o.email}`)} style={{ color: C.brand, fontFamily: F.w700 }}>{o.email}</Text>}
          {o.phone && <Text accessibilityRole="link" onPress={() => Linking.openURL(`tel:${o.phone}`)} style={{ color: C.brand, fontFamily: F.w700 }}>{o.phone}</Text>}
          <Text style={s.muted}>{o.address} · {o.hours}</Text>
          <Text style={s.sub}>We acknowledge within {o.ackHours} hours and resolve within {o.resolveDays} days.</Text>
        </Card>
      )}
      <Card>
        <Text style={s.h2}>File a complaint</Text>
        {done && <Text style={{ color: C.green, fontFamily: F.w700 }}>Received. Ticket {done}.</Text>}
        <Chips options={CAT} value={category} onChange={setCategory} />
        {(category === 'harassment' || category === 'safety') && <Text style={{ color: C.amber, fontFamily: F.w600 }}>This goes only to our grievance committee, in confidence.</Text>}
        <TextInput value={text} onChangeText={setText} multiline maxLength={5000} placeholder="What happened? (at least 20 characters)"
          style={{ minHeight: 120, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, textAlignVertical: 'top', backgroundColor: C.white }} />
        <ErrorText error={error} />
        <Button title="Send complaint" busy={busy} disabled={!category || text.trim().length < 20} onPress={submit} />
      </Card>
      {mine.length > 0 && (
        <Card>
          <Text style={s.h2}>Your complaints</Text>
          {mine.map(g => (
            <View key={g.id} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8, gap: 2 }}>
              <Text style={{ fontFamily: F.w700, color: C.navy }}>{g.ticket_no} · {STATUS[g.status] ?? g.status}</Text>
              {g.resolution && <Text style={s.muted}>{g.resolution}</Text>}
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
