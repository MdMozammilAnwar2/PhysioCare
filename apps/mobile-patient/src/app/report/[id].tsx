import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError } from '../../lib/api';
import { Button, C, Card, Chips, ErrorText, Screen, s } from '../../lib/ui';

const CATEGORIES: [string, string][] = [['no_show', 'Physio didn’t come'], ['behaviour', 'Behaviour'], ['hurt', 'I got hurt'], ['missing_item', 'Something missing'], ['payment', 'Payment'], ['other', 'Other']];

export default function Report() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Something went wrong.');

  async function addPhoto() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (r.canceled) return;
    const a = r.assets[0];
    setBusy(true); setError(null);
    try { const f = await api.upload({ uri: a.uri, name: a.fileName ?? 'photo.jpg', type: a.mimeType ?? 'image/jpeg' }, 'incident'); setFileIds(x => [...x, f.id]); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError(null);
    try { await api.report({ visitId: id, category, description, fileIds }); setDone(true); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  if (done) return (
    <Screen title="We’ve got it">
      <Card><Text style={s.sub}>Our team will look into this and reply to you. If you feel unsafe right now, call 112.</Text></Card>
      <Button title="Back to bookings" onPress={() => router.back()} />
    </Screen>
  );
  return (
    <Screen kicker="Your visit" title="Report a problem" sub="Only our team reads this. If you feel unsafe right now, call 112.">
      <Card>
        <Chips options={CATEGORIES} value={category} onChange={setCategory} />
        <Text style={s.muted}>What happened? (at least 10 characters)</Text>
        <TextInput value={description} onChangeText={setDescription} multiline maxLength={3000} style={{ minHeight: 120, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, textAlignVertical: 'top', backgroundColor: C.white }} />
        <Button title={fileIds.length ? `Photos added: ${fileIds.length} · add another` : 'Add a photo (optional)'} variant="ghost" disabled={busy || fileIds.length >= 5} onPress={addPhoto} />
      </Card>
      <ErrorText error={error} />
      <Button title="Send report" busy={busy} disabled={!category || description.trim().length < 10} onPress={submit} />
    </Screen>
  );
}
