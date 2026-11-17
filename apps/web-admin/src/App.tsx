import { useEffect, useState } from 'react';
import { ADMIN_ROLES } from '@physioconnect/shared';
import { api, ApiError, type Status, type User } from './api';

// Checks the public status API on start and every 60 s, like every PhysioConnect app.
function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => api.status().then(s => { if (alive) { setStatus(s); setDown(false); } }).catch(() => alive && setDown(true));
    check();
    const t = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { status, down };
}

function StatusBar({ status, down }: { status: Status | null; down: boolean }) {
  if (down) return <div className="bg-danger text-white text-sm font-semibold px-4 py-2">Can’t reach the server. Retrying every minute.</div>;
  if (status?.maintenance.enabled) return <div className="bg-warning text-navy text-sm font-semibold px-4 py-2">Maintenance: {status.maintenance.message ?? 'some features may be unavailable.'}</div>;
  return null;
}

function SignIn({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      if (step === 'phone') { await api.sendOtp(phone); setStep('code'); }
      else onSignedIn(await api.verifyOtp(phone, code));
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white rounded-card shadow-sm border border-line p-8 flex flex-col gap-4">
        <p className="text-sm text-sub font-semibold">PhysioConnect by Healthtropic</p>
        <h1 className="text-3xl font-extrabold tracking-tight">Console sign in</h1>
        {step === 'phone' ? (
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">Mobile number
            <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="98765 43210" required
              className="h-12 rounded-xl border border-line px-4 text-base text-ink focus:outline-none focus:ring-2 focus:ring-brand" />
          </label>
        ) : (
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">6-digit code sent to {phone}
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required
              className="h-12 rounded-xl border border-line px-4 text-lg tracking-[0.4em] text-ink focus:outline-none focus:ring-2 focus:ring-brand" />
          </label>
        )}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        <button disabled={busy} className="h-12 rounded-xl bg-navy text-white font-bold disabled:opacity-60">{step === 'phone' ? 'Send code' : 'Sign in'}</button>
        <p className="text-xs text-sub">For PhysioConnect staff only. Every action is saved to the audit log.</p>
      </form>
    </div>
  );
}

function Console({ user, status, onSignOut }: { user: User; status: Status | null; onSignOut: () => void }) {
  const isAdmin = user.roles.some(r => (ADMIN_ROLES as string[]).includes(r));
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 bg-navy text-white p-5 flex flex-col gap-1">
        <span className="text-lg font-extrabold">PhysioConnect</span>
        <span className="text-xs text-white/60 mb-6">Console · {user.primaryRole.replace('_', ' ')}</span>
        <a className="rounded-lg bg-brand px-3 py-2 font-bold" href="#">Command centre</a>
        <span className="mt-auto text-xs text-white/50">v{status?.version ?? '—'}</span>
      </aside>
      <main className="flex-1 p-8 flex flex-col gap-6">
        <div className="flex justify-between items-end">
          <div><p className="text-sm text-sub font-semibold">Phase 0 · Foundations</p><h1 className="text-4xl font-extrabold tracking-tight">Command centre</h1></div>
          <button onClick={onSignOut} className="h-10 px-4 rounded-xl border border-line bg-white font-bold">Sign out</button>
        </div>
        {!isAdmin ? (
          <div className="rounded-card bg-white border border-line p-6"><h2 className="text-xl font-extrabold">No console access</h2><p className="text-sub mt-1">This account isn’t PhysioConnect staff. Access is given by a super admin.</p></div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {Object.entries(status?.services ?? {}).map(([k, v]) => (
              <div key={k} className="rounded-card bg-white border border-line p-5"><p className="text-sm text-sub font-semibold">{k}</p><p className={`text-2xl font-extrabold ${v === 'up' ? 'text-success-ink' : 'text-warning-ink'}`}>{v}</p></div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const { status, down } = useStatus();
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { if (sessionStorage.getItem('pc.access')) api.me().then(setUser).catch(() => sessionStorage.clear()); }, []);
  return (
    <>
      <StatusBar status={status} down={down} />
      {user ? <Console user={user} status={status} onSignOut={() => api.logout().then(() => setUser(null))} /> : <SignIn onSignedIn={setUser} />}
    </>
  );
}
