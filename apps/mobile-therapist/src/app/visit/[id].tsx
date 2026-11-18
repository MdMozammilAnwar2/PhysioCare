import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { api, ApiError, fmtDay, fmtTime, rupees, visitsCache } from '../../lib/api';
import { F, Button, C, Card, Check, ErrorText, Field, Screen, ZonePill, s } from '../../lib/ui';
import { sendSos } from '../../lib/sos';

const LOCATION_EVERY_MS = Number(process.env.EXPO_PUBLIC_LOCATION_EVERY_SECONDS || 60) * 1000;

export default function VisitScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const v0 = visitsCache.list.find(x => x.id === id);
  const [status, setStatus] = useState(v0?.status ?? 'booked');
  const [code, setCode] = useState('');
  const [family, setFamily] = useState(false);
  const [notes, setNotes] = useState({ pain: '', flexion: '', exercises: '', text: '', home: '' });
  const [cashDone, setCashDone] = useState(v0?.payment_status !== 'pending');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Location is shared only while on the way or in session, for safety.
  useEffect(() => {
    const live = status === 'on_the_way' || status === 'checked_in';
    if (!live || !id || v0?.mode === 'video') return;
    const ping = async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const pos = await Location.getCurrentPositionAsync({});
        await api.location(id, pos.coords.latitude, pos.coords.longitude);
      } catch { /* next ping will retry */ }
    };
    ping();
    timer.current = setInterval(ping, LOCATION_EVERY_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [status, id]);

  if (!v0 || !id) return <Redirect href="/schedule" />;
  const v = v0;
  const act = async (fn: () => Promise<unknown>, next?: string) => {
    setError(null); setBusy(true);
    try { await fn(); if (next) setStatus(next); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  };
  async function startTrip() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) setError('Location is off. Your safety team can’t see you during this visit.');
    await act(() => api.onTheWay(id), 'on_the_way');
  }
  const needsFamily = v.physio_consent === 'accepted';
  const isVideo = v.mode === 'video';
  const openVideo = async () => { const r = await api.video(id); await Linking.openURL(r.url); };

  return (
    <Screen kicker={`${fmtDay(v.starts_at)} · ${fmtTime(v.starts_at)}`} title={v.patient_name ?? 'Patient'} sub={`${v.mode}${v.sessions_total && v.sessions_total > 1 ? ` · ${v.sessions_total}-session plan` : ''}`}>
      <Card>
        {v.line1 ? <Text style={s.body}>{v.line1}{v.landmark ? ` · ${v.landmark}` : ''}</Text> : null}
        {v.zone_color ? <ZonePill color={v.zone_color} name={v.zone_name} /> : null}
        {needsFamily && v.family_member ? <Text style={{ color: C.amber, fontFamily: F.w600 }}>Required: {v.family_member.relation} ({v.family_member.name}) must be at home.</Text> : null}
        {v.lat != null && <Button title="Directions" variant="ghost" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`)} />}
      </Card>

      {isVideo && (status === 'booked' || status === 'checked_in') && (
        <Card>
          <Text style={s.h2}>Video session</Text>
          <Text style={s.muted}>Opens {Number(process.env.EXPO_PUBLIC_VIDEO_JOIN_EARLY_MINUTES || 10)} minutes before the start. The patient joins from their bookings.</Text>
          {status === 'booked' && <Button title="Start video session" busy={busy} onPress={() => act(async () => { await api.startVideo(id); await openVideo(); }, 'checked_in')} />}
          {status === 'checked_in' && <Button title="Rejoin video call" variant="ghost" busy={busy} onPress={() => act(openVideo)} />}
        </Card>
      )}

      {!isVideo && status === 'booked' && <Button title="I’m on the way" onPress={startTrip} busy={busy} />}

      {!isVideo && (status === 'booked' || status === 'on_the_way') && (
        <Card>
          <Text style={s.h2}>Check in</Text>
          <Text style={s.muted}>Ask the patient for their 4-digit code. The visit and payment start only with the right code.</Text>
          <Field label="Check-in code" value={code} onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />
          {needsFamily && <Check label={`${v.family_member?.relation ?? 'Family member'} is at home`} value={family} onChange={setFamily} />}
          <Button title="Check in" onPress={() => act(() => api.checkIn(id, code, needsFamily ? family : undefined), 'checked_in')} busy={busy} disabled={code.length !== 4} />
          {needsFamily && <Button title="Nobody present · leave" variant="ghost" onPress={() => act(() => api.nobodyPresent(id), 'cancelled')} />}
        </Card>
      )}

      {status === 'checked_in' && (
        <Card>
          <Text style={s.h2}>Session notes</Text>
          <Field label="Pain score (0–10)" value={notes.pain} onChangeText={t => setNotes(n => ({ ...n, pain: t.replace(/\D/g, '').slice(0, 2) }))} keyboardType="number-pad" />
          <Field label="Knee bend / main measurement (°)" value={notes.flexion} onChangeText={t => setNotes(n => ({ ...n, flexion: t.replace(/[^\d-]/g, '').slice(0, 4) }))} keyboardType="numbers-and-punctuation" />
          <Field label="Exercises done (one per line)" value={notes.exercises} onChangeText={t => setNotes(n => ({ ...n, exercises: t }))} multiline />
          <Field label="Notes" value={notes.text} onChangeText={t => setNotes(n => ({ ...n, text: t }))} multiline />
          <Field label="Home plan" value={notes.home} onChangeText={t => setNotes(n => ({ ...n, home: t }))} multiline />
          <Button title="End visit & save notes" busy={busy} onPress={() => act(() => api.complete(id, {
            painScore: notes.pain ? Math.min(10, Number(notes.pain)) : undefined,
            measurements: notes.flexion ? { main_measurement: Number(notes.flexion) } : undefined,
            exercises: notes.exercises.split('\n').map(x => x.trim()).filter(Boolean).map(name => ({ name })),
            notes: notes.text || undefined, homePlan: notes.home || undefined,
          }), 'completed')} />
        </Card>
      )}

      {status === 'completed' && <Card><Text style={{ color: C.green, fontFamily: F.w700 }}>Visit completed. Notes saved and shared with the patient.</Text></Card>}
      {status === 'cancelled' && <Card><Text style={s.body}>This visit was cancelled. The patient will choose a new time.</Text></Card>}

      {v.payment_method === 'cash' && v.payment_id && !cashDone && (status === 'checked_in' || status === 'completed') && (
        <Button title={`Cash received · ${v.amount_paise ? rupees(v.amount_paise) : ''}`} variant="ghost" busy={busy} onPress={() => act(async () => { await api.cashReceived(v.payment_id!); setCashDone(true); })} />
      )}
      <ErrorText error={error} />

      {!isVideo && (status === 'on_the_way' || status === 'checked_in') && (
        <View style={{ gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="SOS. Hold to alert our safety team and your emergency contacts" delayLongPress={2000}
            onLongPress={() => sendSos(id).catch(e => setError(e instanceof ApiError ? e.message : 'SOS failed. Call 112.'))}
            style={{ backgroundColor: '#F43F5E', borderRadius: 999, width: 140, height: 140, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontFamily: F.w800, fontSize: 30 }}>SOS</Text>
          </Pressable>
          <Text style={[s.muted, { textAlign: 'center' }]}>Hold 2 seconds. Alerts our 24×7 safety team with your location.</Text>
        </View>
      )}
      {v.patient_name && (
        <Text accessibilityRole="button" style={{ color: C.red, fontFamily: F.w700, textAlign: 'center', paddingVertical: 12 }}
          onPress={() => Alert.alert('Block this patient?', 'You won’t be matched with them again. Our team reviews every block. If you are in danger, use SOS or call 112.', [
            { text: 'Cancel', style: 'cancel' },
            ...([['unsafe_home', 'Unsafe home'], ['abuse', 'Abusive'], ['harassment', 'Harassment'], ['payment_default', 'Didn’t pay']] as const).map(([code, label]) => ({
              text: label, style: 'destructive' as const,
              onPress: () => api.blockPatient(v.patient_id, code).then(r => Alert.alert('Blocked', r.message)).catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t block.')),
            })),
          ])}>Block this patient</Text>
      )}
      <Button title="Back to schedule" variant="ghost" onPress={() => router.replace('/schedule')} />
    </Screen>
  );
}
