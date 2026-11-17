import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { ADMIN_ROLES } from '@physioconnect/shared';
import { api, ApiError, hasSession, type Status, type User } from './api';
import { Header, Live, Payments, TherapistReview, VerificationQueue } from './pages';

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

function SignIn({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      if (step === 'phone') { await api.sendOtp(phone); setStep('code'); }
      else onSignedIn(await api.verifyOtp(phone, code));
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Something went wrong.'); } finally { setBusy(false); }
  }
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white rounded-card shadow-sm border border-line p-8 flex flex-col gap-4">
        <p className="text-sm text-sub font-semibold">PhysioConnect by Healthtropic</p>
        <h1 className="text-3xl font-extrabold tracking-tight">Console sign in</h1>
        {step === 'phone' ? (
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">Mobile number
            <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="98765 43210" required className="h-12 rounded-xl border border-line px-4 text-base text-ink focus:outline-none focus:ring-2 focus:ring-brand" />
          </label>
        ) : (
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">6-digit code sent to {phone}
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required className="h-12 rounded-xl border border-line px-4 text-lg tracking-[0.4em] text-ink focus:outline-none focus:ring-2 focus:ring-brand" />
          </label>
        )}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        <button disabled={busy} className="h-12 rounded-xl bg-navy text-white font-bold disabled:opacity-60">{step === 'phone' ? 'Send code' : 'Sign in'}</button>
        <p className="text-xs text-sub">For PhysioConnect staff only. Every action is saved to the audit log.</p>
      </form>
    </div>
  );
}

const NAV: [string, string, string[]][] = [
  ['/live', 'Live visits & SOS', ['ops_admin', 'super_admin', 'city_coordinator']],
  ['/verification', 'Verification', ['ops_admin', 'super_admin', 'city_coordinator']],
  ['/payments', 'Payments to confirm', ['ops_admin', 'finance', 'super_admin']],
];

function Console({ user, status, onSignOut }: { user: User; status: Status | null; onSignOut: () => void }) {
  const nav = NAV.filter(([, , roles]) => user.roles.some(r => roles.includes(r)));
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 shrink-0 bg-navy text-white p-5 flex flex-col gap-1">
        <span className="text-lg font-extrabold">PhysioConnect</span>
        <span className="text-xs text-white/60 mb-6">Console · {user.primaryRole.replace('_', ' ')}</span>
        {nav.map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand font-bold' : 'text-white/80 hover:bg-white/10'}`}>{label}</NavLink>
        ))}
        <span className="mt-auto text-xs text-white/50">{user.name ?? user.phone}</span>
        <button onClick={onSignOut} className="text-left text-xs text-white/70 hover:text-white">Sign out</button>
        <span className="text-xs text-white/40">v{status?.version ?? '—'}</span>
      </aside>
      <main className="flex-1 min-w-0 p-8">
        <Routes>
          <Route path="/live" element={<Live />} />
          <Route path="/verification" element={<VerificationQueue />} />
          <Route path="/verification/:id" element={<TherapistReview />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="*" element={nav[0] ? <Navigate to={nav[0][0]} replace /> : <Header title="No pages for your role yet" />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { status, down } = useStatus();
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(!hasSession());
  useEffect(() => { if (hasSession()) api.me().then(setUser).catch(() => undefined).finally(() => setChecked(true)); }, []);
  if (!checked) return null;
  const isStaff = user?.roles.some(r => ADMIN_ROLES.includes(r));
  return (
    <BrowserRouter>
      {down && <div className="bg-danger text-white text-sm font-semibold px-4 py-2">Can’t reach the server. Retrying every minute.</div>}
      {status?.maintenance.enabled && <div className="bg-warning text-navy text-sm font-semibold px-4 py-2">Maintenance: {status.maintenance.message ?? 'some features may be unavailable.'}</div>}
      {!user ? <SignIn onSignedIn={setUser} /> : !isStaff ? (
        <div className="min-h-screen flex items-center justify-center p-6"><div className="max-w-md bg-white border border-line rounded-card p-8 flex flex-col gap-3">
          <h1 className="text-2xl font-extrabold">No console access</h1><p className="text-sub">This account isn’t PhysioConnect staff. Access is given by a super admin.</p>
          <button onClick={() => api.logout().then(() => setUser(null))} className="h-11 rounded-xl border border-line font-bold">Sign out</button>
        </div></div>
      ) : <Console user={user} status={status} onSignOut={() => api.logout().then(() => setUser(null))} />}
    </BrowserRouter>
  );
}
