import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, ApiError, DOCS, tokens, type Profile } from '../lib/api';
import { F, Button, C, Card, ErrorText, Screen, s } from '../lib/ui';

export default function Status() {
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { api.profile().then(setP).catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t load.')); }, []));
  if (!p) return <Screen title="Getting verified"><ErrorText error={error} /></Screen>;
  const st = p.profile?.verification_status;
  if (st === 'verified') {
    return (
      <Screen title="You’re verified" sub="Set your hours and prices to start getting patients.">
        <Button title="Set hours & prices" onPress={() => router.replace('/hours')} />
        <Button title="Go to schedule" variant="ghost" onPress={() => router.replace('/schedule')} />
      </Screen>
    );
  }
  const approved = p.documents.filter(d => d.status === 'approved').length;
  const rejected = p.documents.filter(d => d.status === 'rejected');
  return (
    <Screen title="Getting verified" sub="You start getting patients once our team approves everything.">
      <Card>
        <Text style={s.h2}>{approved} of {DOCS.length} documents approved</Text>
        <Text style={{ color: st === 'under_review' ? C.amber : C.sub, fontFamily: F.w700 }}>{st === 'under_review' ? 'Under review' : 'Not submitted yet'}</Text>
        {p.profile?.review_note ? <Text style={{ color: C.red }}>Our team says: {p.profile.review_note}</Text> : null}
      </Card>
      {rejected.map(d => (
        <Card key={d.id}><Text style={s.h2}>{DOCS.find(x => x[0] === d.type)?.[1]}</Text><Text style={{ color: C.red }}>{d.review_note ?? 'Please upload again.'}</Text></Card>
      ))}
      {(rejected.length > 0 || st === 'applied') && <Button title="Fix documents" onPress={() => router.push('/documents')} />}
      {st === 'applied' && p.missingDocuments.length === 0 && <Button title="Sign and submit" variant="ghost" onPress={() => router.push('/agreement')} />}
      <Text style={s.muted}>A short video call with our team completes verification. We’ll message you to book it.</Text>
      <Button title="Sign out" variant="ghost" onPress={async () => { await tokens.clear(); router.replace('/'); }} />
    </Screen>
  );
}
