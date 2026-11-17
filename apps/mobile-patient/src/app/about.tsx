import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { api, ApiError } from '../lib/api';
import { Button, Card, Check, Chips, ErrorText, Field, Screen, s } from '../lib/ui';

export default function About() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState<'female' | 'male' | 'other'>('male');
  const [condition, setCondition] = useState<'after_surgery' | 'back_neck' | 'sports' | 'neuro' | 'elderly' | 'child'>('after_surgery');
  const [procedure, setProcedure] = useState('');
  const [preferred, setPreferred] = useState<'female' | 'male' | 'any'>('any');
  const [agree, setAgree] = useState({ location: false, terms: false, surgeon: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!agree.location || !agree.terms) return setError('Please accept the two required consents.');
    setError(null); setBusy(true);
    try {
      await api.updateMe({ name, gender, birthYear: birthYear ? Number(birthYear) : undefined });
      await api.saveProfile({ conditionCategory: condition, procedure: procedure || undefined, preferredGender: preferred });
      await api.consents([{ document: 'location_sharing', version: '1.0', accepted: true }, { document: 'terms', version: '2.1', accepted: true }, { document: 'surgeon_sharing', version: '1.0', accepted: agree.surgeon }]);
      router.replace('/where');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  }
  return (
    <Screen kicker="Step 1 of 4" title="About you" sub="This helps us match the right physiotherapist.">
      <Card>
        <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" />
        <Field label="Year of birth" value={birthYear} onChangeText={t => setBirthYear(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />
        <Text style={s.label}>Gender</Text>
        <Chips options={[['female', 'Female'], ['male', 'Male'], ['other', 'Other']]} value={gender} onChange={setGender} />
      </Card>
      <Card>
        <Text style={s.h2}>What do you need help with?</Text>
        <Chips options={[['after_surgery', 'After surgery'], ['back_neck', 'Back & neck'], ['sports', 'Sports injury'], ['neuro', 'Stroke & neuro'], ['elderly', 'Elderly care'], ['child', 'Child physio']]} value={condition} onChange={setCondition} />
        <Field label="Procedure (if any)" value={procedure} onChangeText={setProcedure} placeholder="e.g. ACL reconstruction" />
        <Text style={s.label}>Physiotherapist</Text>
        <Chips options={[['female', 'Female'], ['male', 'Male'], ['any', 'No preference']]} value={preferred} onChange={setPreferred} />
      </Card>
      <Card>
        <Check label="Share my location and recovery details with my matched physiotherapist (required)" value={agree.location} onChange={v => setAgree(a => ({ ...a, location: v }))} />
        <Check label="I agree to the Terms, Code of Conduct and Privacy Policy (required)" value={agree.terms} onChange={v => setAgree(a => ({ ...a, terms: v }))} />
        <Check label="Share my recovery progress with my surgeon (optional)" value={agree.surgeon} onChange={v => setAgree(a => ({ ...a, surgeon: v }))} />
        <ErrorText error={error} />
        <Button title="Continue" onPress={save} busy={busy} disabled={name.trim().length < 2} />
      </Card>
    </Screen>
  );
}
