import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, ApiError } from '../../lib/api';
import { F, Button, C, Card, ErrorText, Screen, s } from '../../lib/ui';

const TAGS: [string, string][] = [['on_time', 'On time'], ['explained_clearly', 'Explained clearly'], ['respectful', 'Respectful'], ['felt_better', 'I feel better'], ['too_rushed', 'Too rushed'], ['late', 'Came late']];

export default function Rate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await api.rate(id, { stars, tags, comment: comment.trim() || undefined }); router.back(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  }
  return (
    <Screen kicker="Your visit" title="How was it?">
      <Card>
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
          {[1, 2, 3, 4, 5].map(n => (
            <Pressable key={n} onPress={() => setStars(n)} accessibilityRole="radio" accessibilityState={{ checked: stars === n }} accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`} hitSlop={6}>
              <Text style={{ fontSize: 40, color: n <= stars ? '#F59E0B' : C.line }}>★</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TAGS.map(([v, l]) => {
            const on = tags.includes(v);
            return (
              <Pressable key={v} onPress={() => setTags(x => (on ? x.filter(y => y !== v) : [...x, v]))} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: on ? C.navy : C.white, borderWidth: 1, borderColor: on ? C.navy : C.line }}>
                <Text style={{ color: on ? C.white : C.navy, fontFamily: F.w700 }}>{l}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={s.muted}>Anything else? (optional)</Text>
        <TextInput value={comment} onChangeText={setComment} multiline maxLength={1000} style={{ minHeight: 90, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, textAlignVertical: 'top', backgroundColor: C.white }} />
      </Card>
      <ErrorText error={error} />
      <Button title="Send rating" disabled={!stars} busy={busy} onPress={submit} />
    </Screen>
  );
}
