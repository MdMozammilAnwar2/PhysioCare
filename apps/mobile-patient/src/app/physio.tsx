import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, ApiError, draft, rupees, type Match } from '../lib/api';
import { Button, C, Card, Check, ErrorText, Screen, s } from '../lib/ui';

export default function Physio() {
  const router = useRouter();
  const [family, setFamily] = useState(Boolean(draft.family));
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setMatches(null);
    api.match({ mode: draft.mode, addressId: draft.addressId, familyPresent: family }).then(r => setMatches(r.matches)).catch(e => setError(e instanceof ApiError ? e.message : 'Something went wrong.'));
  }, [family]);
  function pick(m: Match) {
    Object.assign(draft, { therapistId: m.id, therapistName: m.name, requiresConsent: m.requiresFamilyAndConsent, family });
    router.push('/time');
  }
  return (
    <Screen kicker="Step 3 of 4" title="Your top 3" sub="Verified physiotherapists who treat your problem near you.">
      <Check label="An adult family member will be at home during visits" value={family} onChange={setFamily} />
      <ErrorText error={error} />
      {matches === null && !error && <Text style={s.muted}>Finding physios…</Text>}
      {matches?.length === 0 && <Card><Text style={s.h2}>No physio is free near you yet</Text><Text style={s.muted}>Try a video session.</Text></Card>}
      {matches?.map((m, i) => (
        <Card key={m.id} highlight={i === 0}>
          {i === 0 && <Text style={s.kicker}>BEST MATCH</Text>}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.h2}>{m.name}</Text>
              <Text style={s.muted}>{m.qualification} · {m.yearsExperience} yrs{m.distanceKm !== null ? ` · ${m.distanceKm} km` : ''}{m.rating ? ` · ★ ${m.rating}` : ''}</Text>
              {m.requiresFamilyAndConsent && <Text style={{ color: C.amber, fontWeight: '600', fontSize: 13 }}>Needs your family member present and his consent</Text>}
            </View>
            <Text style={{ fontSize: 20, fontWeight: '800', color: C.navy }}>{rupees(m.pricePaise)}</Text>
          </View>
          <Button title="Choose" variant={i === 0 ? 'primary' : 'ghost'} onPress={() => pick(m)} />
        </Card>
      ))}
    </Screen>
  );
}
