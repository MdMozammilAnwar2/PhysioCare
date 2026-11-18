import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, cms, comms, isSignedIn, type Site } from './api';
import { Logo } from './Logo';

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

// Every page: header (links from Website › Site settings), status check (start + every 60 s), footer.
const NavLinkTo = ({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) =>
  href.startsWith('/') ? <Link to={href} className={className}>{children}</Link> : <a href={href} className={className}>{children}</a>;
export function Shell({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.status>> | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [down, setDown] = useState(false);
  const [menu, setMenu] = useState(false);
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => { setMenu(false); if (isSignedIn()) comms.unread().then(r => setUnread(r.unread)).catch(() => undefined); }, [loc.pathname]);
  useEffect(() => {
    cms.site().then(r => setSite(r.site)).catch(() => undefined);
    const check = () => api.status().then(s => { setStatus(s); setDown(false); }).catch(() => setDown(true));
    check();
    const t = setInterval(check, Number(import.meta.env.VITE_STATUS_CHECK_SECONDS || 60) * 1000);
    return () => clearInterval(t);
  }, []);
  const wa = site?.whatsapp?.replace(/\D/g, '');
  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 bg-white px-4 py-2 rounded-xl z-50">Skip to content</a>
      {down && <div className="bg-danger text-white text-sm font-semibold px-4 py-2 text-center">We’re having trouble connecting. Booked visits are not affected.</div>}
      {status?.maintenance.enabled && <div className="bg-warning text-ink text-sm font-semibold px-4 py-2 text-center">{status.maintenance.message ?? 'Scheduled maintenance in progress.'}</div>}
      {site?.announcement.enabled && site.announcement.text && (
        <div className="bg-ink text-white text-sm font-semibold px-4 py-2 text-center">{site.announcement.href ? <NavLinkTo href={site.announcement.href} className="underline">{site.announcement.text}</NavLinkTo> : site.announcement.text}</div>
      )}
      <header className="bg-white border-b border-line sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-6 text-[15px] font-semibold">
          <Link to="/" aria-label="PhysioCare home" className="shrink-0"><Logo height={32} endorsed /></Link>
          <nav aria-label="Main" className="hidden lg:flex items-center gap-6 text-sub">{site?.nav.map(l => <NavLinkTo key={l.href} href={l.href} className="hover:text-brand">{l.label}</NavLinkTo>)}</nav>
          <span className="flex-1" />
          {isSignedIn() ? (
            <>
              <Link to="/notifications" aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} className="relative text-xl leading-none">🔔{unread > 0 && <span className="absolute -top-1.5 -right-2 min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center">{unread > 9 ? '9+' : unread}</span>}</Link>
              <Link to="/bookings" className="hidden md:inline">My bookings</Link>
              <Link to="/rewards" className="hidden md:inline">Refer &amp; coins</Link>
              <button onClick={() => api.signOut().then(() => navigate('/'))} className="hidden md:inline text-sub">Sign out</button>
            </>
          ) : <Link to="/signin" className="hidden md:inline">Sign in</Link>}
          <Link to="/book" className="h-11 px-5 rounded-xl bg-brand text-white font-bold flex items-center shrink-0">Book a visit</Link>
          <button onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-label="Menu" className="lg:hidden w-11 h-11 rounded-xl border border-line flex items-center justify-center text-xl">{menu ? '×' : '☰'}</button>
        </div>
        {menu && (
          <nav aria-label="Mobile" className="lg:hidden border-t border-line px-4 py-3 flex flex-col gap-1 bg-white">
            {site?.nav.map(l => <NavLinkTo key={l.href} href={l.href} className="py-3 font-semibold">{l.label}</NavLinkTo>)}
            {isSignedIn() ? <>
              <Link to="/bookings" className="py-3 font-semibold">My bookings</Link>
              <Link to="/rewards" className="py-3 font-semibold">Refer &amp; coins</Link>
              <button onClick={() => api.signOut().then(() => navigate('/'))} className="py-3 text-left text-sub">Sign out</button>
            </> : <Link to="/signin" className="py-3 font-semibold">Sign in</Link>}
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="bg-ink text-white/80 mt-10">
        <div className="max-w-6xl mx-auto px-4 py-12 grid grid-cols-2 md:grid-cols-6 gap-8 text-sm">
          <div className="col-span-2 flex flex-col gap-3">
            <Logo variant="dark" height={30} endorsed />
            {site?.tagline && <p>{site.tagline}</p>}
            {site?.supportPhone && <a href={`tel:${site.supportPhone}`} className="font-bold text-white">📞 {site.supportPhone}</a>}
            {wa && <a href={`https://wa.me/${wa.length === 10 ? `91${wa}` : wa}`} target="_blank" rel="noreferrer" className="font-bold text-white">WhatsApp us</a>}
            {site?.email && <a href={`mailto:${site.email}`} className="text-white">{site.email}</a>}
            {site?.hours && <p>{site.hours}</p>}
            {site?.address && <p>{site.address}</p>}
          </div>
          {site?.footer.map(col => (
            <div key={col.heading} className="flex flex-col gap-2">
              <p className="font-bold text-white">{col.heading}</p>
              {col.links.map(l => <NavLinkTo key={l.href} href={l.href} className="hover:text-white">{l.label}</NavLinkTo>)}
            </div>
          ))}
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/60">
          <span>© {new Date().getFullYear()} Healthtropic. PhysioCare is not an emergency service. In an emergency call 112.</span>
          <span>v{status?.version ?? '—'}</span>
          {site?.social && Object.entries(site.social).filter(([, v]) => v).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" className="capitalize hover:text-white">{k}</a>)}
        </div>
      </footer>
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
