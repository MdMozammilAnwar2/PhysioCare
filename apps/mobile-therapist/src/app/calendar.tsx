import { useCallback, useState } from 'react';
import { Alert, Linking, Share, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError, fmtDay, fmtTime } from '../lib/api';
import { F, Button, C, Card, ErrorText, Field, Screen, s } from '../lib/ui';

type Cal = Awaited<ReturnType<typeof api.calendar>>;
const NAME: Record<string, string> = { google: 'Google Calendar', calendly: 'Calendly' };

// Connect outside calendars: their appointments block your PhysioCare times; your visits appear in Google Calendar.
export default function CalendarScreen() {
  const [d, setD] = useState<Cal | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const load = useCallback(() => { api.calendar().then(setD).catch(e => setError(e instanceof ApiError ? e.message : 'Something went wrong.')); }, []);
  useFocusEffect(load);
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setError(null); setInfo(null);
    try { await fn(); if (done) setInfo(done); load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  };
  const has = (p: string) => d?.connections.some(c => c.provider === p);
  return (
    <Screen kicker="Settings" title="Calendar" sub="Your other appointments block those times on PhysioCare, so patients can’t book you when you’re busy.">
      {info && <Text style={{ color: C.green, fontFamily: F.w700 }}>{info}</Text>}
      <ErrorText error={error} />
      {d?.connections.map(c => (
        <Card key={c.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={s.h2}>{NAME[c.provider] ?? c.provider}</Text>
            <Text style={{ fontFamily: F.w700, color: c.status === 'active' ? C.green : C.red }}>{c.status === 'active' ? 'Connected' : c.status === 'revoked' ? 'Reconnect needed' : 'Problem'}</Text>
          </View>
          {c.account_email && <Text style={s.muted}>{c.account_email}</Text>}
          <Text style={s.muted}>{c.last_synced_at ? `Last checked ${fmtDay(c.last_synced_at)} ${fmtTime(c.last_synced_at)}` : 'Not checked yet'}</Text>
          {c.last_error && <Text style={{ color: C.red, fontFamily: F.w400 }}>{c.last_error}</Text>}
          <Button title="Disconnect" variant="ghost" onPress={() => Alert.alert('Disconnect?', `PhysioCare will stop reading ${NAME[c.provider]}.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: () => act(() => api.disconnectCalendar(c.id), 'Disconnected.') }])} />
        </Card>
      ))}
      {d && d.connections.length > 0 && <Button title="Check calendars now" variant="ghost" busy={busy} onPress={() => act(() => api.calendarSync(), 'Calendars checked.')} />}

      {d && !has('google') && (
        <Card>
          <Text style={s.h2}>Google Calendar</Text>
          <Text style={s.muted}>Two-way: your Google appointments block PhysioCare times, and PhysioCare visits appear in Google Calendar (patient’s first name and area only).</Text>
          {d.googleAvailable
            ? <Button title="Connect Google Calendar" busy={busy} onPress={() => act(async () => { const r = await api.googleConnect(); await Linking.openURL(r.url); }, 'Finish signing in with Google in the browser, then come back here.')} />
            : <Text style={{ color: C.amber, fontFamily: F.w600 }}>Not available yet. Our team is setting it up.</Text>}
        </Card>
      )}
      {d && !has('calendly') && (
        <Card>
          <Text style={s.h2}>Calendly</Text>
          <Text style={s.muted}>If you take bookings on Calendly, those times are blocked here. In Calendly open Integrations › API & Webhooks › Personal access tokens, create one and paste it below.</Text>
          <Field label="Calendly personal access token" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Button title="Connect Calendly" busy={busy} disabled={token.trim().length < 20} onPress={() => act(async () => { await api.calendly(token.trim()); setToken(''); }, 'Calendly connected.')} />
        </Card>
      )}
      {d && (
        <Card>
          <Text style={s.h2}>Show visits in any calendar app</Text>
          <Text style={s.muted}>A private link for Apple, Outlook or Google Calendar (“subscribe from URL”). Anyone with it can see your visit times, so don’t share it.</Text>
          <Button title="Add to my phone’s calendar" onPress={() => Linking.openURL(d.feedUrl.replace(/^https?:/, 'webcal:')).catch(() => Share.share({ message: d.feedUrl }))} />
          <Button title="Copy / share the link" variant="ghost" onPress={() => Share.share({ message: d.feedUrl })} />
          <Text accessibilityRole="button" onPress={() => Alert.alert('Make a new link?', 'The old link stops working.', [{ text: 'Cancel', style: 'cancel' }, { text: 'New link', onPress: () => act(() => api.rotateFeed(), 'New link made.') }])} style={{ color: C.sub, fontFamily: F.w700, textDecorationLine: 'underline', paddingVertical: 8 }}>Make a new link</Text>
        </Card>
      )}
    </Screen>
  );
}
