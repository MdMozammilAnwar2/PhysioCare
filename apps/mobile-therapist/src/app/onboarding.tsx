import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, ApiError } from '../lib/api';
import { F, Button, C, Card, Check, Chips, ErrorText, Field, Screen, s } from '../lib/ui';

function Multi<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map(([v, l]) => {
        const on = value.includes(v);
        return (
          <Pressable key={v} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onChange(on ? value.filter(x => x !== v) : [...value, v])}
            style={[s.chip, on ? { backgroundColor: C.navy } : { backgroundColor: C.white, borderWidth: 1, borderColor: C.line }]}>
            <Text style={{ color: on ? C.white : C.navy, fontFamily: on ? F.w700 : F.w500, fontSize: 15 }}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Step 1 of 3: about you, what you treat, where you visit.
export default function Onboarding() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'female' | 'male'>('female');
  const [qualification, setQualification] = useState<'BPT' | 'MPT'>('BPT');
  const [years, setYears] = useState('');
  const [specs, setSpecs] = useState<('after_surgery' | 'back_neck' | 'sports' | 'neuro' | 'elderly' | 'child')[]>(['after_surgery']);
  const [langs, setLangs] = useState<('hi' | 'en' | 'bho' | 'mai' | 'ur')[]>(['hi']);
  const [zones, setZones] = useState<{ id: string; name: string; lat: number; lng: number }[]>([]);
  const [base, setBase] = useState<string | null>(null);
  const [radius, setRadius] = useState<'4' | '6' | '8' | '10'>('6');
  const [femaleOnly, setFemaleOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.zones().then(r => setZones(r.zones)).catch(() => undefined); }, []);

  async function save() {
    const z = zones.find(x => x.id === base);
    if (name.trim().length < 2) return setError('Enter your full name as on Aadhaar.');
    if (!z) return setError('Pick the area you start from.');
    setError(null); setBusy(true);
    try {
      await api.updateMe({ name: name.trim(), gender });
      await api.saveProfile({ qualification, yearsExperience: Number(years) || 0, specialisations: specs, languages: langs, homeLat: z.lat, homeLng: z.lng, serviceRadiusKm: Number(radius), femalePatientsOnly: femaleOnly });
      router.replace('/documents');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  }
  return (
    <Screen kicker="Step 1 of 3" title="About your practice">
      <Card>
        <Field label="Full name (as on Aadhaar)" value={name} onChangeText={setName} autoComplete="name" />
        <Text style={s.label}>Gender</Text>
        <Chips options={[['female', 'Female'], ['male', 'Male']]} value={gender} onChange={setGender} />
        <Text style={s.label}>Qualification</Text>
        <Chips options={[['BPT', 'BPT'], ['MPT', 'MPT']]} value={qualification} onChange={setQualification} />
        <Field label="Years of experience" value={years} onChangeText={t => setYears(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
      </Card>
      <Card>
        <Text style={s.h2}>What you treat</Text>
        <Multi options={[['after_surgery', 'Post-surgery'], ['back_neck', 'Back & neck'], ['sports', 'Sports'], ['neuro', 'Neuro'], ['elderly', 'Geriatric'], ['child', 'Paediatric']]} value={specs} onChange={setSpecs} />
        <Text style={s.label}>Languages</Text>
        <Multi options={[['hi', 'Hindi'], ['en', 'English'], ['bho', 'Bhojpuri'], ['mai', 'Maithili'], ['ur', 'Urdu']]} value={langs} onChange={setLangs} />
      </Card>
      <Card>
        <Text style={s.h2}>Where you visit</Text>
        <Text style={s.label}>You start from</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {zones.map(z => (
            <Pressable key={z.id} onPress={() => setBase(z.id)} accessibilityRole="button" accessibilityState={{ selected: base === z.id }}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: base === z.id ? C.navy : C.white, borderWidth: 1, borderColor: C.line }}>
              <Text style={{ color: base === z.id ? C.white : C.navy, fontFamily: F.w600 }}>{z.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.label}>Service radius</Text>
        <Chips options={[['4', '4 km'], ['6', '6 km'], ['8', '8 km'], ['10', '10 km']]} value={radius} onChange={setRadius} />
        <Check label="Female patients only" value={femaleOnly} onChange={setFemaleOnly} />
        <Text style={s.muted}>Red zones are closed to visits. Orange zones have extra safety rules.</Text>
        <ErrorText error={error} />
        <Button title="Next: documents" onPress={save} busy={busy} disabled={specs.length === 0 || langs.length === 0} />
      </Card>
    </Screen>
  );
}
