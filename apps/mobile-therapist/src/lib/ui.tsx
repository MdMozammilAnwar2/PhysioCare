// Style A components for React Native.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export const C = { brand: '#5146D9', navy: '#1F1A4D', sub: '#5E5A7A', line: '#E4E1F5', bg: '#F7F6FC', soft: '#EFEDFD', lavender: '#8B7FF0', lavenderLight: '#C9C3F7', lavenderOnDark: '#A99FF5', white: '#FFFFFF', green: '#047857', amber: '#B45309', red: '#BE123C' };
// Plus Jakarta Sans, one file per weight (React Native can't synthesise weights for custom fonts). Loaded in _layout.tsx.
export const F = { w400: 'PlusJakartaSans_400Regular', w500: 'PlusJakartaSans_500Medium', w600: 'PlusJakartaSans_600SemiBold', w700: 'PlusJakartaSans_700Bold', w800: 'PlusJakartaSans_800ExtraBold' } as const;
export const ZONE: Record<string, [string, string]> = { green: ['#D1FAE5', 'Live'], blue: ['#E0F2FE', 'Launching'], yellow: ['#FEF9C3', 'Limited supply'], orange: ['#FFEDD5', 'Restricted'], red: ['#FFE4E8', 'Blocked'] };

export const Screen = ({ title, kicker, sub, children }: { title: string; kicker?: string; sub?: string; children: ReactNode }) => (
  <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }} keyboardShouldPersistTaps="handled">
    <View style={{ gap: 6, paddingHorizontal: 4 }}>
      {kicker ? <Text style={s.kicker}>{kicker}</Text> : null}
      <Text style={s.h1}>{title}</Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
    </View>
    {children}
  </ScrollView>
);

export const Card = ({ children, highlight }: { children: ReactNode; highlight?: boolean }) => (
  <View style={[s.card, highlight && { borderColor: C.brand, borderWidth: 2 }]}>{children}</View>
);

export function Button({ title, onPress, variant = 'primary', disabled, busy }: { title: string; onPress: () => void; variant?: 'primary' | 'dark' | 'ghost'; disabled?: boolean; busy?: boolean }) {
  const bg = variant === 'primary' ? C.brand : variant === 'dark' ? C.navy : C.white;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, variant === 'ghost' && { borderWidth: 1, borderColor: C.line }]}>
      {busy ? <ActivityIndicator color={variant === 'ghost' ? C.navy : C.white} /> : <Text style={[s.btnText, variant === 'ghost' && { color: C.navy }]}>{title}</Text>}
    </Pressable>
  );
}

export const Field = ({ label, ...p }: TextInputProps & { label: string }) => (
  <View style={{ gap: 6 }}>
    <Text style={s.label}>{label}</Text>
    <TextInput placeholderTextColor="#8C88A6" {...p} style={s.input} accessibilityLabel={label} />
  </View>
);

export function Chips<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map(([v, l]) => (
        <Pressable key={v} accessibilityRole="button" accessibilityState={{ selected: v === value }} onPress={() => onChange(v)}
          style={[s.chip, v === value ? { backgroundColor: C.navy } : { backgroundColor: C.white, borderWidth: 1, borderColor: C.line }]}>
          <Text style={{ color: v === value ? C.white : C.navy, fontFamily: v === value ? F.w700 : F.w500, fontSize: 15 }}>{l}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const Check = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: 44 }}>
    <View style={[s.box, value && { backgroundColor: C.brand, borderColor: C.brand }]}>{value ? <Text style={{ color: C.white, fontFamily: F.w800 }}>✓</Text> : null}</View>
    <Text style={{ flex: 1, fontSize: 15, color: C.navy, lineHeight: 21 }}>{label}</Text>
  </Pressable>
);

export const ZonePill = ({ color, name }: { color: string; name?: string | null }) => {
  const [bg, label] = ZONE[color] ?? ZONE.red;
  return <View style={{ alignSelf: 'flex-start', backgroundColor: bg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}><Text style={{ fontFamily: F.w700, fontSize: 13, color: C.navy }}>{name ? `${name} · ` : ''}{label}</Text></View>;
};

export const ErrorText = ({ error }: { error: string | null }) => (error ? <Text accessibilityRole="alert" style={{ color: C.red, fontFamily: F.w600 }}>{error}</Text> : null);

export const s = StyleSheet.create({
  h1: { fontSize: 30, fontFamily: F.w800, color: C.navy, letterSpacing: -0.6 },
  h2: { fontSize: 19, fontFamily: F.w700, color: C.navy },
  kicker: { fontSize: 13, fontFamily: F.w700, color: C.brand },
  sub: { fontSize: 16, color: C.sub, lineHeight: 22, fontFamily: F.w400 },
  body: { fontSize: 15, color: C.navy },
  muted: { fontSize: 13, color: C.sub, fontFamily: F.w400 },
  label: { fontSize: 13, fontFamily: F.w600, color: C.sub },
  card: { backgroundColor: C.white, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 16, gap: 12 },
  btn: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnText: { color: C.white, fontSize: 17, fontFamily: F.w700 },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, paddingHorizontal: 14, fontSize: 17, color: C.navy },
  chip: { minHeight: 44, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center' },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#C8D2E2', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
