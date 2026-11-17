import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, isSignedIn } from './api';

const ZONE = { green: ['bg-success/15 text-success-ink', 'Live'], blue: ['bg-sky-100 text-sky-700', 'Launching'], yellow: ['bg-yellow-100 text-yellow-800', 'Limited supply'], orange: ['bg-orange-100 text-orange-700', 'Restricted'], red: ['bg-danger/15 text-danger-ink', 'Blocked'] } as const;
export function ZonePill({ color, name }: { color: keyof typeof ZONE; name?: string | null }) {
  const [cls, label] = ZONE[color] ?? ZONE.red;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${cls}`}>{name ? `${name} · ` : ''}{label}</span>;
}

export function Button({ children, variant = 'primary', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'dark' | 'ghost' }) {
  const v = { primary: 'bg-brand text-white', dark: 'bg-navy text-white', ghost: 'bg-white border border-line text-ink' }[variant];
  return <button {...p} className={`h-12 px-6 rounded-xl font-bold disabled:opacity-50 ${v} ${p.className ?? ''}`}>{children}</button>;
}

export function Field({ label, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">{label}
      <input {...p} className="h-12 rounded-xl border border-line bg-white px-4 text-base text-ink focus:outline-none focus:ring-2 focus:ring-brand" />
    </label>
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T | T[]; onChange: (v: T) => void }) {
  const on = (o: T) => (Array.isArray(value) ? value.includes(o) : value === o);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, l]) => (
        <button type="button" key={v} onClick={() => onChange(v)} aria-pressed={on(v)}
          className={`min-h-11 px-4 rounded-full text-[15px] ${on(v) ? 'bg-navy text-white font-bold' : 'bg-white border border-line'}`}>{l}</button>
      ))}
    </div>
  );
}

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <section className={`bg-white border border-line rounded-card p-6 flex flex-col gap-4 ${className}`}>{children}</section>
);

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p role="alert" className="text-sm font-semibold text-danger-ink">{error}</p> : null;
}

// Every page: nav + the status check (start + every 60 s) + footer.
export function Shell({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.status>> | null>(null);
  const [down, setDown] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const check = () => api.status().then(s => { setStatus(s); setDown(false); }).catch(() => setDown(true));
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      {down && <div className="bg-danger text-white text-sm font-semibold px-4 py-2 text-center">We’re having trouble connecting. Booked visits are not affected.</div>}
      {status?.maintenance.enabled && <div className="bg-warning text-navy text-sm font-semibold px-4 py-2 text-center">{status.maintenance.message ?? 'Scheduled maintenance in progress.'}</div>}
      <nav className="bg-white border-b border-line">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-8 text-[15px] font-medium">
          <Link to="/" className="flex items-center gap-2.5 text-xl font-extrabold"><span className="w-7 h-7 rounded-lg bg-brand" />PhysioConnect</Link>
          <span className="flex-1" />
          {isSignedIn() ? (
            <>
              <Link to="/bookings" className="hidden sm:inline">My bookings</Link>
              <button onClick={() => api.signOut().then(() => navigate('/'))} className="text-sub">Sign out</button>
            </>
          ) : <Link to="/signin" className="hidden sm:inline">Sign in</Link>}
          <Link to="/book" className="h-11 px-5 rounded-xl bg-navy text-white font-bold flex items-center">Book a visit</Link>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
      <footer className="max-w-6xl w-full mx-auto px-6 py-10 text-sm text-sub">PhysioConnect by Healthtropic · v{status?.version ?? '—'}</footer>
    </div>
  );
}

export const Page = ({ kicker, title, sub, children }: { kicker?: string; title: string; sub?: string; children: ReactNode }) => (
  <div className="max-w-3xl mx-auto px-6 py-12 flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      {kicker && <span className="text-sm font-bold text-brand">{kicker}</span>}
      <h1 className="text-4xl font-extrabold tracking-tight">{title}</h1>
      {sub && <p className="text-lg text-sub">{sub}</p>}
    </div>
    {children}
  </div>
);
