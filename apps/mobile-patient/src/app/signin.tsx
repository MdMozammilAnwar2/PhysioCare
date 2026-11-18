import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { api, ApiError } from '../lib/api';
import { Button, Card, ErrorText, Field, Screen, s } from '../lib/ui';
import { registerForPush } from '../lib/push';

export default function SignIn() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [ref, setRef] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function next() {
    setError(null); setBusy(true);
    try {
      if (step === 'phone') { const r = await api.sendOtp(phone); if (r.devCode) setCode(r.devCode); setStep('code'); return; }
      const r = await api.verifyOtp(phone, code, ref.trim() || undefined);
      registerForPush().catch(() => undefined);
      router.replace(r.isNew || !r.user.name ? '/about' : '/bookings');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  }
  return (
    <Screen title={step === 'phone' ? 'Your mobile number' : 'Enter the code'} sub={step === 'phone' ? 'We’ll text you a 6-digit code. No password needed.' : `Sent to +91 ${phone}.`}>
      <Card>
        {step === 'phone' ? (
          <>
            <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="98765 43210" />
            <Field label="Doctor’s or friend’s referral code (optional)" value={ref} onChangeText={setRef} autoCapitalize="characters" placeholder="e.g. K7MP-4QXR" />
          </>
        ) : (
          <Field label="6-digit code" value={code} onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" />
        )}
        <ErrorText error={error} />
        <Button title={step === 'phone' ? 'Send code' : 'Verify'} onPress={next} busy={busy} />
        <Text style={s.muted}>Your number is never shown to your physiotherapist.</Text>
      </Card>
    </Screen>
  );
}
