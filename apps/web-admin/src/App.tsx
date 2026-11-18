import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { canOpen, labelFor, mainRole, menuFor, ROLE_LABEL, ROLE_ORDER } from './access';
import { Dashboard } from './dashboards';
import { ADMIN_ROLES } from '@physioconnect/shared';
import { api, ApiError, hasSession, type Status, type User } from './api';
import { Logo } from './Logo';
import { CmsPageEditor, CmsPages, SiteSettingsPage } from './cms-editor';
import { CalendarPage } from './calendar-page';
import { MessagesPage } from './messages-page';
import { Header, Live, Payments, TherapistReview, VerificationQueue } from './pages';
import { Incidents, MoneyRulesPage, Payouts, Refunds, Tds } from './money-pages';
import { GrowthReport, GrowthRulesPage, PartnerDetail, Partners } from './growth-pages';
import { AuditLog, Blocks, GrievanceDetail, Grievances, PlatformSettings, Staff, UserDetail, Users, Zones } from './control-pages';

// Checks the public status API on start and every 60 s, like every PhysioCare app.
function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => api.status().then(s => { if (alive) { setStatus(s); setDown(false); } }).catch(() => alive && setDown(true));
    check();
    const t = setInterval(check, Number(import.meta.env.VITE_STATUS_CHECK_SECONDS || 60) * 1000);
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
  const [devCode, setDevCode] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      if (step === 'phone') { const r = await api.sendOtp(phone); setDevCode(r.devCode ?? null); if (r.devCode) setCode(r.devCode); setStep('code'); }
      else onSignedIn(await api.verifyOtp(phone, code));
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Something went wrong.'); } finally { setBusy(false); }
  }
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white rounded-card shadow-sm border border-line p-8 flex flex-col gap-4">
        <Logo height={34} endorsed />
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
        {devCode && step === 'code' && <p className="text-sm rounded-xl bg-mist text-ink px-3 py-2">Development mode: no SMS is sent. Your code is <b className="font-mono">{devCode}</b> (filled in for you).</p>}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        <button disabled={busy} className="h-12 rounded-xl bg-navy text-white font-bold disabled:opacity-60">{step === 'phone' ? 'Send code' : 'Sign in'}</button>
        <p className="text-xs text-sub">For PhysioCare staff only. Every action is saved to the audit log.</p>
      </form>
    </div>
  );
}

// Guards a page: people without the role see a clear message instead of a broken page.
function Guard({ roles, children }: { roles: string[]; children: React.ReactElement }) {
  const loc = useLocation();
  if (canOpen(roles, loc.pathname)) return children;
  return (
    <div className="max-w-lg rounded-card bg-white border border-line p-8 flex flex-col gap-3">
      <h1 className="text-2xl font-extrabold">Not available for your role</h1>
      <p className="text-sub">This page is for other staff. Ask a super admin if you need access.</p>
      <Link to="/dashboard" className="text-brand font-bold">Back to your dashboard ›</Link>
    </div>
  );
}

function TopBar({ user, status, onSignOut }: { user: User; status: Status | null; onSignOut: () => void }) {
  const loc = useLocation();
  const roles = ROLE_ORDER.filter(r => user.roles.includes(r));
  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-line">
      <div className="px-8 h-16 flex items-center gap-4">
        <p className="text-sm text-sub font-semibold truncate">{labelFor(loc.pathname) ?? 'Console'}</p>
        <span className="flex-1" />
        <div className="hidden md:flex gap-1.5">{roles.map(r => <span key={r} className={`rounded-full px-2.5 py-1 text-xs font-bold ${r === 'super_admin' ? 'bg-ink text-white' : 'bg-mist text-brand'}`}>{ROLE_LABEL[r]}</span>)}</div>
        <div className="text-right leading-tight">
          <p className="text-sm font-bold">{user.name ?? 'Staff'}</p>
          <p className="text-xs text-sub">{user.phone}</p>
        </div>
        <span className="w-9 h-9 rounded-full bg-brand text-white font-extrabold flex items-center justify-center" aria-hidden>{(user.name ?? user.phone).replace(/^\+91/, '').charAt(0).toUpperCase()}</span>
        <button onClick={onSignOut} className="h-9 px-3 rounded-lg border border-line text-sm font-semibold">Sign out</button>
      </div>
      {status?.maintenance.enabled && <div className="bg-warning/20 text-warning-ink text-xs font-semibold px-8 py-1.5">Maintenance mode is on: {status.maintenance.message ?? 'visitors see a banner'}</div>}
    </header>
  );
}

function Console({ user, status, onSignOut }: { user: User; status: Status | null; onSignOut: () => void }) {
  const menu = menuFor(user.roles);
  const role = mainRole(user.roles);
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 shrink-0 bg-navy text-white flex flex-col sticky top-0 h-screen">
        <div className="px-5 pt-5 pb-4 border-b border-white/10">
          <Logo variant="dark" height={28} />
          <p className="mt-2 text-xs text-white/60">Console · {ROLE_LABEL[role] ?? role}</p>
        </div>
        <nav aria-label="Console" className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-4">
          {menu.map(sec => (
            <div key={sec.title} className="flex flex-col gap-0.5">
              {menu.length > 1 && <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/40">{sec.title}</p>}
              {sec.items.map(i => (
                <NavLink key={i.path} to={i.path} className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand font-bold text-white' : 'text-white/80 hover:bg-white/10'}`}>
                  <span className="w-4 text-center opacity-80" aria-hidden>{i.icon}</span>{i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <p className="px-5 py-3 text-[11px] text-white/40 border-t border-white/10">PhysioCare v{status?.version ?? '—'}</p>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar user={user} status={status} onSignOut={onSignOut} />
      <main className="flex-1 min-w-0 p-8">
        <Routes>
          <Route path="/dashboard" element={<Dashboard roles={user.roles} name={user.name} />} />
          <Route path="/website/pages" element={<Guard roles={user.roles}><CmsPages /></Guard>} />
          <Route path="/website/pages/:id" element={<Guard roles={user.roles}><CmsPageEditor /></Guard>} />
          <Route path="/website/settings" element={<Guard roles={user.roles}><SiteSettingsPage /></Guard>} />
          <Route path="/messages" element={<Guard roles={user.roles}><MessagesPage isSuper={user.roles.includes('super_admin')} /></Guard>} />
          <Route path="/calendar" element={<Guard roles={user.roles}><CalendarPage /></Guard>} />
          <Route path="/users" element={<Guard roles={user.roles}><Users /></Guard>} />
          <Route path="/users/:id" element={<Guard roles={user.roles}><UserDetail me={user.id} isSuper={user.roles.includes('super_admin')} /></Guard>} />
          <Route path="/blocks" element={<Guard roles={user.roles}><Blocks /></Guard>} />
          <Route path="/staff" element={<Guard roles={user.roles}><Staff /></Guard>} />
          <Route path="/zones" element={<Guard roles={user.roles}><Zones isSuper={user.roles.includes('super_admin')} /></Guard>} />
          <Route path="/grievances" element={<Guard roles={user.roles}><Grievances /></Guard>} />
          <Route path="/grievances/:id" element={<Guard roles={user.roles}><GrievanceDetail /></Guard>} />
          <Route path="/settings" element={<Guard roles={user.roles}><PlatformSettings isSuper={user.roles.includes('super_admin')} /></Guard>} />
          <Route path="/audit" element={<Guard roles={user.roles}><AuditLog /></Guard>} />
          <Route path="/live" element={<Guard roles={user.roles}><Live /></Guard>} />
          <Route path="/verification" element={<Guard roles={user.roles}><VerificationQueue /></Guard>} />
          <Route path="/verification/:id" element={<Guard roles={user.roles}><TherapistReview /></Guard>} />
          <Route path="/payments" element={<Guard roles={user.roles}><Payments /></Guard>} />
          <Route path="/incidents" element={<Guard roles={user.roles}><Incidents /></Guard>} />
          <Route path="/refunds" element={<Guard roles={user.roles}><Refunds canPay={user.roles.some(r => r === 'finance' || r === 'super_admin')} /></Guard>} />
          <Route path="/payouts" element={<Guard roles={user.roles}><Payouts /></Guard>} />
          <Route path="/tds" element={<Guard roles={user.roles}><Tds /></Guard>} />
          <Route path="/money-rules" element={<Guard roles={user.roles}><MoneyRulesPage canEdit={user.roles.includes('super_admin')} /></Guard>} />
          <Route path="/partners" element={<Guard roles={user.roles}><Partners canAdd={user.roles.some(r => ['ops_admin', 'city_coordinator', 'super_admin'].includes(r))} /></Guard>} />
          <Route path="/partners/:id" element={<Guard roles={user.roles}><PartnerDetail canDecide={user.roles.some(r => ['ops_admin', 'city_coordinator', 'super_admin'].includes(r))} canPay={user.roles.some(r => r === 'finance' || r === 'super_admin')} /></Guard>} />
          <Route path="/growth" element={<Guard roles={user.roles}><GrowthReport /></Guard>} />
          <Route path="/growth-rules" element={<Guard roles={user.roles}><GrowthRulesPage canEdit={user.roles.includes('super_admin')} /></Guard>} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      </div>
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
          <h1 className="text-2xl font-extrabold">No console access</h1><p className="text-sub">This account isn’t PhysioCare staff. Access is given by a super admin.</p>
          <button onClick={() => api.logout().then(() => setUser(null))} className="h-11 rounded-xl border border-line font-bold">Sign out</button>
        </div></div>
      ) : <Console user={user} status={status} onSignOut={() => api.logout().then(() => setUser(null))} />}
    </BrowserRouter>
  );
}
