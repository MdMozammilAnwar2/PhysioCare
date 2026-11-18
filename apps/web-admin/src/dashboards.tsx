// One dashboard per role. Each shows what that person acts on first; tiles only link to pages the role can open.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { canOpen, mainRole, ROLE_LABEL } from './access';
import { ApiError, control, rupees, when, type Dashboard as Data } from './api';

const CAT: Record<string, string> = { service: 'Service', physio_conduct: 'Physio conduct', safety: 'Safety', harassment: 'Harassment', payment: 'Payment', refund: 'Refund', privacy: 'Privacy', app: 'App', other: 'Other' };
const HEADLINE: Record<string, [string, string]> = {
  super_admin: ['Business overview', 'Everything across PhysioCare today.'],
  ops_admin: ['Operations today', 'Safety, visits and the queues waiting for you.'],
  finance: ['Money desk', 'Collections, payouts, refunds and partner rewards.'],
  city_coordinator: ['City operations', 'Physios, partners and visits in your city.'],
  grievance_committee: ['Grievance desk', 'Complaints and their legal time limits (acknowledge in 24 h, resolve in 15 days).'],
  content_editor: ['Website', 'Pages, drafts and what changed recently.'],
};

function Tile({ label, value, to, roles, alert, sub }: { label: string; value: React.ReactNode; to?: string; roles: string[]; alert?: boolean; sub?: string }) {
  const body = (
    <div className={`rounded-xl px-4 py-3 h-full ${alert ? 'bg-danger/10 border border-danger/30' : 'bg-white border border-line'}`}>
      <p className="text-xs text-sub font-semibold">{label}</p>
      <p className={`text-2xl font-extrabold tabular-nums ${alert ? 'text-danger-ink' : ''}`}>{value}</p>
      {sub && <p className="text-xs text-sub mt-0.5">{sub}</p>}
    </div>
  );
  return to && canOpen(roles, to) ? <Link to={to} className="block hover:-translate-y-0.5 transition-transform">{body}</Link> : body;
}
const Section = ({ title, children, cols = 'md:grid-cols-4' }: { title: string; children: React.ReactNode; cols?: string }) => (
  <section className="flex flex-col gap-2"><h2 className="font-extrabold">{title}</h2><div className={`grid grid-cols-2 ${cols} gap-3`}>{children}</div></section>
);

function Trend({ d, money }: { d: NonNullable<Data['trend']>; money: boolean }) {
  const key = money ? 'collected' : 'completed';
  const max = Math.max(1, ...d.map(t => Number(t[key] ?? 0)));
  return (
    <section className="rounded-card bg-white border border-line p-5">
      <p className="font-extrabold mb-3">{money ? 'Collected, last 14 days' : 'Completed visits, last 14 days'}</p>
      <div className="flex items-end gap-1.5 h-32" role="img" aria-label={`${money ? 'Collected per day' : 'Completed visits per day'}: ${d.map(t => (money ? rupees(t.collected ?? 0) : t.completed)).join(', ')}`}>
        {d.map(t => {
          const v = Number(t[key] ?? 0);
          return (
            <div key={t.day} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${t.day}: ${t.completed} visits${money ? `, ${rupees(t.collected ?? 0)}` : ''}`}>
              <span className="text-[10px] text-sub tabular-nums">{v ? (money ? `${Math.round(v / 100000)}k` : v) : ''}</span>
              <div className="w-full rounded-t bg-brand" style={{ height: `${(100 * v) / max}%`, minHeight: v ? 4 : 1, opacity: v ? 1 : 0.2 }} />
              <span className="text-[10px] text-sub">{Number(t.day.slice(8))}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Dashboard({ roles, name }: { roles: string[]; name?: string | null }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () => control.dashboard().then(setD).catch(e => setErr(e instanceof ApiError ? e.message : 'Couldn’t load the dashboard.'));
    load(); const t = setInterval(load, 60_000); return () => clearInterval(t);
  }, []);
  const role = mainRole(roles);
  const [title, sub] = HEADLINE[role] ?? ['Dashboard', ''];
  const hour = Number(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const q = d?.queues ?? {};
  const has = (k: Data['sections'][number]) => Boolean(d?.sections.includes(k));
  const finFirst = role === 'finance';

  const today = has('today') && d?.today && (
    <Section title="Today">
      <Tile roles={roles} label="Visits" value={d.today.visits} to="/live" />
      <Tile roles={roles} label="In progress" value={d.today.live} to="/live" />
      <Tile roles={roles} label="Completed" value={d.today.completed} to="/calendar" />
      <Tile roles={roles} label="Cancelled / no-show" value={d.today.lost} to="/calendar" />
    </Section>
  );
  const queues = has('queues') && role !== 'grievance_committee' && (
    <Section title="Needs action" cols="md:grid-cols-3 xl:grid-cols-4">
      {'verifications' in q && <Tile roles={roles} label="Physios to verify" value={q.verifications ?? 0} to="/verification" />}
      {'payments' in q && <Tile roles={roles} label="Payments to confirm" value={q.payments ?? 0} to="/payments" />}
      {'incidents' in q && <Tile roles={roles} label="Open incidents" value={q.incidents ?? 0} to="/incidents" alert={(q.incidents ?? 0) > 0} />}
      {'refunds' in q && <Tile roles={roles} label="Refunds to decide or send" value={q.refunds ?? 0} to="/refunds" />}
      {'partners' in q && <Tile roles={roles} label="Partners to review" value={q.partners ?? 0} to="/partners" />}
      {'grievances' in q && <Tile roles={roles} label="Open grievances" value={q.grievances ?? 0} to="/grievances" />}
      {'grievances_overdue' in q && <Tile roles={roles} label="Grievances overdue" value={q.grievances_overdue ?? 0} to="/grievances" alert={(q.grievances_overdue ?? 0) > 0} />}
      {'blocked' in q && <Tile roles={roles} label="Blocked accounts" value={q.blocked ?? 0} to="/blocks" />}
    </Section>
  );
  const money = has('money') && d?.money && (
    <Section title="Money" cols="md:grid-cols-3">
      <Tile roles={roles} label="Collected, 7 days" value={rupees(d.money.collected_7d)} to="/payments" />
      <Tile roles={roles} label="Collected, 30 days" value={rupees(d.money.collected_30d)} to="/tds" />
      <Tile roles={roles} label="Not yet paid by patients" value={rupees(d.money.outstanding)} to="/payments" />
      <Tile roles={roles} label="Physio payouts due" value={rupees(d.money.payouts_due)} to="/payouts" />
      <Tile roles={roles} label="Refunds to send" value={rupees(d.money.refunds_due)} to="/refunds" />
      <Tile roles={roles} label="Partner rewards due" value={rupees(d.money.partner_rewards_due)} to="/partners" />
    </Section>
  );
  const growth = has('growth') && d?.growth && (
    <Section title="Growth" cols="md:grid-cols-5">
      <Tile roles={roles} label="Sign-ups today" value={d.growth.signups_today} to="/growth" />
      <Tile roles={roles} label="Sign-ups, 7 days" value={d.growth.signups_7d} to="/growth" />
      <Tile roles={roles} label="First paid visit, 7 days" value={d.growth.first_paid_7d} to="/growth" />
      <Tile roles={roles} label="Verified physios" value={d.growth.physios_verified} to="/verification" />
      <Tile roles={roles} label="Active partners" value={d.growth.partners_active} to="/partners" />
    </Section>
  );
  const g = d?.grievance;
  const grievance = has('grievance') && g && (role === 'grievance_committee' || role === 'super_admin' || role === 'ops_admin') && (
    <div className="flex flex-col gap-3">
      <Section title={role === 'grievance_committee' ? 'Complaints' : 'Grievances'}>
        <Tile roles={roles} label="Open" value={g.open} to="/grievances" />
        <Tile roles={roles} label="To acknowledge" value={g.to_acknowledge} to="/grievances" alert={g.to_acknowledge > 0} sub="within 24 hours" />
        <Tile roles={roles} label="Overdue" value={g.overdue} to="/grievances" alert={g.overdue > 0} />
        <Tile roles={roles} label="Due in 3 days" value={g.due_3_days} to="/grievances" />
        {role !== 'ops_admin' && <Tile roles={roles} label="Committee only (harassment, safety)" value={g.committee_open} to="/grievances" />}
        <Tile roles={roles} label="Resolved, 30 days" value={g.resolved_30d} to="/grievances" />
        <Tile roles={roles} label="Average days to resolve" value={g.avg_days_to_resolve} sub="last 90 days · limit 15" alert={g.avg_days_to_resolve > 15} />
      </Section>
      {role === 'grievance_committee' && g.byCategory.length > 0 && (
        <section className="rounded-card bg-white border border-line p-5 flex flex-col gap-2">
          <p className="font-extrabold">Open by category</p>
          {g.byCategory.map(c => (
            <div key={c.category} className="grid grid-cols-[150px_1fr_auto] gap-3 items-center text-sm">
              <span className="font-semibold">{CAT[c.category] ?? c.category}</span>
              <div className="h-3 rounded-full bg-canvas overflow-hidden"><div className={`h-full ${['harassment', 'safety'].includes(c.category) ? 'bg-danger' : 'bg-brand'}`} style={{ width: `${(100 * c.n) / Math.max(1, g.open)}%` }} /></div>
              <span className="tabular-nums">{c.n}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
  const w = d?.website;
  const website = has('website') && w && (role === 'content_editor' || role === 'super_admin') && (
    <div className="flex flex-col gap-3">
      <Section title="Website" cols="md:grid-cols-5">
        <Tile roles={roles} label="Published pages" value={w.published} to="/website/pages" />
        <Tile roles={roles} label="Drafts" value={w.drafts} to="/website/pages" />
        <Tile roles={roles} label="Edits not yet published" value={w.unpublished_edits} to="/website/pages" alert={w.unpublished_edits > 0} />
        <Tile roles={roles} label="Blog posts" value={w.blog_posts} to="/website/pages" />
        <Tile roles={roles} label="Legal pages awaiting review" value={w.legal_drafts} to="/website/pages" alert={w.legal_drafts > 0} sub="marked “for legal review”" />
      </Section>
      {role === 'content_editor' && (
        <section className="rounded-card bg-white border border-line p-5 flex flex-col gap-2">
          <div className="flex justify-between"><p className="font-extrabold">Recently edited</p><Link to="/website/pages" className="text-brand font-bold text-sm">All pages ›</Link></div>
          {w.recent.map(p => (
            <Link key={p.id} to={`/website/pages/${p.id}`} className="flex justify-between gap-3 text-sm border-t border-line pt-2 first:border-0 first:pt-0 hover:text-brand">
              <span><b>{p.title}</b> <span className="text-sub font-mono text-xs">/{p.slug}</span></span>
              <span className="text-sub whitespace-nowrap">{p.status} · {when(p.updated_at)}{p.by_name ? ` · ${p.by_name}` : ''}</span>
            </Link>
          ))}
          <div className="flex gap-2 pt-2">
            <Link to="/website/pages" className="h-10 px-4 rounded-xl bg-brand text-white font-bold text-sm inline-flex items-center">Edit pages</Link>
            <Link to="/website/settings" className="h-10 px-4 rounded-xl border border-line font-bold text-sm inline-flex items-center">Site settings</Link>
          </div>
        </section>
      )}
    </div>
  );
  // Order follows the role: finance sees money first; ops sees today and the queues first.
  const order = finFirst ? [queues, money, today, growth] : [today, queues, money, growth];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-sub font-semibold">{greet}{name ? `, ${name.split(' ')[0]}` : ''} · {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        <p className="text-sub">{sub}{roles.length > 1 ? ` You also have: ${roles.filter(r => r !== role && ROLE_LABEL[r]).map(r => ROLE_LABEL[r]).join(', ')}.` : ''}</p>
      </div>
      {err && <p role="alert" className="text-sm font-semibold text-danger-ink">{err}</p>}
      {(q.sos ?? 0) > 0 && <Link to="/live" className="rounded-xl bg-danger text-white font-extrabold px-5 py-4">🚨 {q.sos} SOS open. Open live visits now ›</Link>}
      {!d && !err && <div className="h-40 rounded-card bg-mist animate-pulse" />}
      {role === 'grievance_committee' ? grievance : role === 'content_editor' ? website : <>{order}{grievance}{website}</>}
      {d?.trend && (role !== 'content_editor' && role !== 'grievance_committee') && <Trend d={d.trend} money={finFirst} />}
    </div>
  );
}
