import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { api, ApiError } from '../lib/api';
import { Button, Card, Check, ErrorText, Field, Screen, s } from '../lib/ui';

const POINTS = [
  ['Service agreement', 'Your price minus the platform fee and TDS; payouts after a 7-day hold.'],
  ['Code of conduct', 'Respect, privacy, no off-app visits or payments outside PhysioConnect.'],
  ['Gender safety rule', 'A male physio visits a woman patient only with an adult family member present and both consents. If nobody is home, you leave and tap “Nobody present”.'],
  ['Strikes and blocking', 'Breaking the rules can lead to a warning, suspension or removal.'],
];

// Step 3 of 3: sign the partner agreement, then submit for review.
export default function Agreement() {
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function sign() {
    if (!agree || name.trim().length < 2) return setError('Tick the box and type your full name to sign.');
    setError(null); setBusy(true);
    try {
      await api.signAgreement(name.trim());
      await api.submit();
      router.replace('/status');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'documents_missing') { setError('Some documents are missing.'); router.replace('/documents'); }
      else setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally { setBusy(false); }
  }
  return (
    <Screen kicker="Step 3 of 3" title="Partner agreement" sub="Version 2.1. Please read before signing.">
      {POINTS.map(([t, d]) => <Card key={t}><Text style={s.h2}>{t}</Text><Text style={s.body}>{d}</Text></Card>)}
      <Card>
        <Check label="I have read and agree to all of the above" value={agree} onChange={setAgree} />
        <Field label="Type your full name to sign" value={name} onChangeText={setName} />
        <ErrorText error={error} />
        <Button title="Sign and submit for review" onPress={sign} busy={busy} />
      </Card>
    </Screen>
  );
}
