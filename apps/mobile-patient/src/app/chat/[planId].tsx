import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api, ApiError, fmtTime } from '../../lib/api';
import { C, ErrorText, s } from '../../lib/ui';

type Msg = { id: number; body: string; created_at: string; mine: boolean };

// Chat with the physio for one plan; polls every 5 s. The server blocks phone numbers and off-app payments.
export default function Chat() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const [items, setItems] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  const scroll = useRef<{ scrollToEnd: (o?: { animated?: boolean }) => void } | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => api.messages(planId, last.current).then(r => {
      if (!alive || !r.messages.length) return;
      last.current = r.messages[r.messages.length - 1].id;
      setItems(x => [...x.filter(m => !r.messages.some(n => n.id === m.id)), ...r.messages]);
    }).catch(e => alive && setError(e instanceof ApiError ? e.message : 'Something went wrong.'));
    poll(); const t = setInterval(poll, Number(process.env.EXPO_PUBLIC_CHAT_REFRESH_SECONDS || 5) * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [planId]);
  async function send() {
    const body = text.trim(); if (!body) return; setError(null);
    try {
      const r = await api.send(planId, body);
      setItems(x => [...x, { id: r.id, body, created_at: new Date().toISOString(), mine: true }]);
      last.current = Math.max(last.current, r.id); setText('');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); }
  }
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={s.h1}>Messages</Text>
        <Text style={s.muted}>For your safety, phone numbers and payments outside the app can’t be shared here.</Text>
      </View>
      <ScrollView ref={scroll as never} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} contentContainerStyle={{ padding: 16, gap: 8 }}>
        {items.length === 0 && <Text style={s.muted}>No messages yet. Say hello.</Text>}
        {items.map(m => (
          <View key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '80%', backgroundColor: m.mine ? C.brand : C.white, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ color: m.mine ? C.white : C.navy, fontSize: 16 }}>{m.body}</Text>
            <Text style={{ color: m.mine ? 'rgba(255,255,255,0.7)' : C.sub, fontSize: 12 }}>{fmtTime(m.created_at)}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={{ padding: 12, gap: 6 }}>
        <ErrorText error={error} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={text} onChangeText={setText} maxLength={1000} placeholder="Type a message" accessibilityLabel="Message" style={{ flex: 1, minHeight: 48, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, backgroundColor: C.white }} />
          <Pressable onPress={send} accessibilityRole="button" style={{ minHeight: 48, paddingHorizontal: 18, borderRadius: 12, backgroundColor: C.brand, justifyContent: 'center' }}>
            <Text style={{ color: C.white, fontWeight: '800' }}>Send</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
