import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError, DOCS, type DocType, type Profile } from '../lib/api';
import { Button, C, Card, ErrorText, Screen, s } from '../lib/ui';

// Step 2 of 3: upload the six documents. Each one is stored permanently and reviewed by our team.
export default function Documents() {
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [busy, setBusy] = useState<DocType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.profile().then(setP).catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t load.')); }, []);
  useFocusEffect(load);

  async function upload(type: DocType) {
    const camera = type === 'selfie';
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : { granted: true };
    if (!perm.granted) return setError('Allow camera access to take your selfie.');
    const r = camera
      ? await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    setError(null); setBusy(type);
    try {
      const f = await api.upload({ uri: a.uri, name: a.fileName ?? `${type}.jpg`, type: a.mimeType ?? 'image/jpeg' });
      await api.addDocument(type, f.id);
      load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Upload failed.'); } finally { setBusy(null); }
  }
  const status = (t: DocType) => p?.documents.find(d => d.type === t);
  const done = p && p.missingDocuments.length === 0;
  return (
    <Screen kicker="Step 2 of 3" title="Documents" sub="Clear photos. We store only what’s needed and check each one by hand.">
      {DOCS.map(([type, label, hint]) => {
        const d = status(type);
        const color = !d ? C.sub : d.status === 'approved' ? C.green : d.status === 'rejected' ? C.red : C.amber;
        const text = !d ? 'Not added' : d.status === 'approved' ? 'Approved' : d.status === 'rejected' ? 'Upload again' : 'Waiting for review';
        return (
          <Card key={type}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1 }}><Text style={s.h2}>{label}</Text><Text style={s.muted}>{hint}</Text></View>
              <Text style={{ color, fontWeight: '700' }}>{text}</Text>
            </View>
            {d?.status === 'rejected' && d.review_note ? <Text style={{ color: C.red }}>{d.review_note}</Text> : null}
            {d?.status !== 'approved' && <Button title={d ? 'Replace' : type === 'selfie' ? 'Take selfie' : 'Upload'} variant="ghost" onPress={() => upload(type)} busy={busy === type} />}
          </Card>
        );
      })}
      <ErrorText error={error} />
      <Button title="Next: agreement" onPress={() => router.push('/agreement')} disabled={!done} />
    </Screen>
  );
}
