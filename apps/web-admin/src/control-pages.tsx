import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, control, grievances, ROLE_LABEL, rupees, when, type BlockRow, type GrievanceRow, type Scheduling, type UserRow, type Zone } from './api';
import { Header } from './pages';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <section className={`rounded-card bg-white border border-line p-5 ${className}`}>{children}</section>;
const Btn = ({ tone = 'dark', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'dark' | 'brand' | 'ghost' | 'danger' }) => (
  <button {...p} className={`h-10 px-4 rounded-xl font-bold text-sm disabled:opacity-50 ${{ dark: 'bg-navy text-white', brand: 'bg-brand text-white', ghost: 'bg-white border border-line', danger: 'bg-white border border-danger/40 text-danger-ink' }[tone]} ${p.className ?? ''}`} />
);
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="text-sm font-semibold text-danger-ink">{e}</p> : null);
const input = 'h-11 rounded-xl border border-line px-3 text-ink text-base bg-white';
function Tabs({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return <div className="flex gap-2 flex-wrap">{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={`h-10 px-4 rounded-full text-sm font-bold ${value === v ? 'bg-navy text-white' : 'bg-white border border-line'}`}>{l}</button>)}</div>;
}
const Tile = ({ label, value, to, alert }: { label: string; value: React.ReactNode; to?: string; alert?: boolean }) => {
  const body = <div className={`rounded-xl px-4 py-3 h-full ${alert ? 'bg-danger/10 border border-danger/30' : 'bg-white border border-line'}`}><p className="text-xs text-sub font-semibold">{label}</p><p className={`text-2xl font-extrabold tabular-nums ${alert ? 'text-danger-ink' : ''}`}>{value}</p></div>;
  return to ? <Link to={to} className="block hover:-translate-y-0.5 transition-transform">{body}</Link> : body;
};
const ZONE_BG: Record<string, string> = { green: '#D1FAE5', blue: '#E0F2FE', yellow: '#FEF9C3', orange: '#FFEDD5', red: '#FFE4E8' };
const ZONE_INK: Record<string, string> = { green: '#047857', blue: '#0369A1', yellow: '#A16207', orange: '#C2410C', red: '#BE123C' };
const ZONE_MEANING: Record<string, string> = { green: 'Live', blue: 'Launching', yellow: 'Limited supply', orange: 'Restricted', red: 'Blocked' };
const ZonePill = ({ color }: { color: string }) => <span className="rounded-full px-2.5 py-1 text-xs font-bold capitalize" style={{ background: ZONE_BG[color], color: ZONE_INK[color] }}>{color} · {ZONE_MEANING[color]}</span>;
const REASON_LABEL: Record<string, string> = { fraud: 'Fraud', abuse: 'Abuse', harassment: 'Harassment', safety: 'Safety risk', no_show_repeat: 'Repeated no-shows', payment_default: 'Not paying', fake_documents: 'Fake documents', off_platform: 'Taking business off the app', spam: 'Spam', legal: 'Legal order', other: 'Other', unsafe_home: 'Unsafe home' };

// ---------- Users and blocks ----------
export function Users() {
  const [qs, setQs] = useState({ q: '', role: '', status: '' });
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => control.users(qs).then(r => setRows(r.users)).catch(e => setErr(msg(e))), 250); return () => clearTimeout(t); }, [qs]);
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="People" title="Users" />
      <div className="flex gap-2 flex-wrap">
        <input value={qs.q} onChange={e => setQs({ ...qs, q: e.target.value })} placeholder="Search name or phone" className={`${input} flex-1 min-w-[220px]`} />
        <select value={qs.role} onChange={e => setQs({ ...qs, role: e.target.value })} className={input}><option value="">All roles</option>{Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select value={qs.status} onChange={e => setQs({ ...qs, status: e.target.value })} className={input}><option value="">Any status</option><option value="active">Active</option><option value="blocked">Blocked</option></select>
      </div>
      <Err e={err} />
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-sub text-left"><tr>{['Name', 'Roles', 'Joined', 'Last sign-in', 'Status', ''].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className="px-4 py-6 text-sub">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-sub">No one found.</td></tr>}
            {rows?.map(u => (
              <tr key={u.id} className="border-t border-line">
                <td className="px-4 py-3"><div className="font-bold">{u.name ?? '—'}</div><div className="text-sub">{u.phone}</div></td>
                <td className="px-4 py-3">{u.roles.map(r => ROLE_LABEL[r] ?? r).join(', ')}</td>
                <td className="px-4 py-3">{when(u.created_at)}</td>
                <td className="px-4 py-3">{when(u.last_login_at)}</td>
                <td className="px-4 py-3">{u.status === 'blocked' ? <span className="font-bold text-danger-ink">Blocked{u.block ? ` · ${REASON_LABEL[u.block.reason] ?? u.block.reason}` : ''}</span> : 'Active'}</td>
                <td className="px-4 py-3 text-right"><Link to={`/users/${u.id}`} className="font-bold text-brand">Open ›</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function UserDetail({ me, isSuper }: { me: string; isSuper: boolean }) {
  const { id = '' } = useParams();
  const [d, setD] = useState<Awaited<ReturnType<typeof control.user>> | null>(null);
  const [form, setForm] = useState({ reasonCode: 'abuse', note: '', days: '' });
  const [liftNote, setLiftNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { control.user(id).then(setD).catch(e => setErr(msg(e))); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div><Header title="User" /><Err e={err} /></div>;
  const u = d.user;
  const protectedAcc = u.roles.includes('super_admin') || u.id === me;
  const staffAcc = u.roles.some(r => ['ops_admin', 'finance', 'city_coordinator', 'grievance_committee'].includes(r));
  const canAct = !protectedAcc && (!staffAcc || isSuper);
  async function block(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!window.confirm(`Block ${u.name ?? u.phone}? They are signed out everywhere at once.`)) return;
    try { await control.block(id, { reasonCode: form.reasonCode, note: form.note, days: form.days ? Number(form.days) : undefined }); setForm({ ...form, note: '', days: '' }); load(); } catch (x) { setErr(msg(x)); }
  }
  async function unblock(e: React.FormEvent) { e.preventDefault(); setErr(null); try { await control.unblock(id, liftNote); setLiftNote(''); load(); } catch (x) { setErr(msg(x)); } }
  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <Header kicker={`${u.phone} · ${u.roles.map(r => ROLE_LABEL[r] ?? r).join(', ')}`} title={u.name ?? 'Unnamed'} right={<span className={`rounded-full px-3 py-1 text-sm font-bold ${u.status === 'blocked' ? 'bg-danger/15 text-danger-ink' : 'bg-success/15 text-success-ink'}`}>{u.status}</span>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Joined" value={<span className="text-base">{when(u.created_at)}</span>} />
        <Tile label="Last sign-in" value={<span className="text-base">{when(u.last_login_at)}</span>} />
        <Tile label="Visits" value={d.visits.total} />
        <Tile label="Completed" value={d.visits.completed} />
      </div>
      <Err e={err} />
      {protectedAcc && <p className="text-sm text-sub">{u.id === me ? 'This is your account.' : 'Super admin accounts can’t be blocked from the app.'}</p>}
      {!protectedAcc && !canAct && <p className="text-sm text-sub">Only a super admin can block or unblock staff.</p>}
      {canAct && u.status !== 'blocked' && (
        <Card>
          <form onSubmit={block} className="flex flex-col gap-3">
            <p className="font-extrabold">Block this account</p>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] gap-3">
              <select value={form.reasonCode} onChange={e => setForm({ ...form, reasonCode: e.target.value })} className={input}>{d.reasons.map(r => <option key={r} value={r}>{REASON_LABEL[r] ?? r}</option>)}</select>
              <input type="number" min={1} placeholder="Days (blank = until review)" value={form.days} onChange={e => setForm({ ...form, days: e.target.value })} className={input} />
            </div>
            <textarea required minLength={5} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows={3} placeholder="What happened? (kept in the audit log)" className="rounded-xl border border-line p-3" />
            <div><Btn tone="danger">Block</Btn></div>
          </form>
        </Card>
      )}
      {canAct && u.status === 'blocked' && (
        <Card>
          <form onSubmit={unblock} className="flex flex-col gap-3">
            <p className="font-extrabold">Unblock</p>
            <input required minLength={3} value={liftNote} onChange={e => setLiftNote(e.target.value)} placeholder="Why? (sent to them)" className={input} />
            <div><Btn tone="brand">Unblock</Btn></div>
          </form>
        </Card>
      )}
      <h2 className="text-xl font-extrabold">Block history</h2>
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-canvas text-sub text-left"><tr>{['When', 'Reason', 'Note', 'Until', 'Lifted'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{d.blocks.length === 0 ? <tr><td colSpan={5} className="px-4 py-4 text-sub">Never blocked.</td></tr> : d.blocks.map(b => (
            <tr key={b.id} className="border-t border-line align-top"><td className="px-4 py-3">{when(b.created_at)}<div className="text-sub">by {b.blocked_by_name ?? '—'}</div></td><td className="px-4 py-3">{REASON_LABEL[b.reason_code] ?? b.reason_code}</td><td className="px-4 py-3">{b.note}</td><td className="px-4 py-3">{b.ends_at ? when(b.ends_at) : 'Until review'}</td><td className="px-4 py-3">{b.lifted_at ? `${when(b.lifted_at)} · ${b.lift_note ?? ''}` : '—'}</td></tr>
          ))}</tbody></table>
      </Card>
      <h2 className="text-xl font-extrabold">Personal blocks</h2>
      <Card className="flex flex-col gap-2 text-sm">
        {d.personalBlocks.length === 0 && <p className="text-sub">None.</p>}
        {d.personalBlocks.map(p => <p key={p.blocker_id + p.blocked_id}><b>{p.blocker_name ?? '—'}</b> blocked <b>{p.blocked_name ?? '—'}</b> · {REASON_LABEL[p.reason_code ?? ''] ?? p.reason_code ?? ''} {p.note ? `· “${p.note}”` : ''} · {when(p.created_at)}</p>)}
      </Card>
    </div>
  );
}

export function Blocks() {
  const [tab, setTab] = useState('active');
  const [rows, setRows] = useState<BlockRow[] | null>(null);
  const [personal, setPersonal] = useState<Awaited<ReturnType<typeof control.personalBlocks>>['blocks'] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    if (tab === 'personal') control.personalBlocks().then(r => setPersonal(r.blocks)).catch(e => setErr(msg(e)));
    else control.blocks(tab === 'active').then(r => setRows(r.blocks)).catch(e => setErr(msg(e)));
  }, [tab]);
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="People" title="Blocked accounts" right={<Tabs value={tab} onChange={setTab} options={[['active', 'Blocked now'], ['lifted', 'Lifted'], ['personal', 'Physio ↔ patient blocks']]} />} />
      <p className="text-sm text-sub">To block someone, find them in <Link to="/users" className="text-brand font-bold">Users</Link>. Personal blocks are made by physios and patients themselves; review them for patterns.</p>
      <Err e={err} />
      <Card className="p-0 overflow-x-auto">
        {tab === 'personal' ? (
          <table className="w-full text-sm"><thead className="bg-canvas text-sub text-left"><tr>{['Who blocked', 'Blocked', 'Reason', 'When'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{personal?.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-sub">None.</td></tr>}{personal?.map(p => (
              <tr key={p.blocker_id + p.blocked_id} className="border-t border-line"><td className="px-4 py-3"><Link to={`/users/${p.blocker_id}`} className="font-bold text-brand">{p.blocker_name ?? p.blocker_phone}</Link></td><td className="px-4 py-3"><Link to={`/users/${p.blocked_id}`} className="font-bold text-brand">{p.blocked_name ?? p.blocked_phone}</Link></td><td className="px-4 py-3">{REASON_LABEL[p.reason_code ?? ''] ?? p.reason_code}{p.note ? ` · “${p.note}”` : ''}</td><td className="px-4 py-3">{when(p.created_at)}</td></tr>
            ))}</tbody></table>
        ) : (
          <table className="w-full text-sm"><thead className="bg-canvas text-sub text-left"><tr>{['Account', 'Reason', 'Note', 'Until', 'By', ''].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows === null && <tr><td colSpan={6} className="px-4 py-6 text-sub">Loading…</td></tr>}{rows?.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-sub">None.</td></tr>}{rows?.map(b => (
              <tr key={b.id} className="border-t border-line align-top"><td className="px-4 py-3"><div className="font-bold">{b.name ?? '—'}</div><div className="text-sub">{b.phone} · {b.roles.map(r => ROLE_LABEL[r] ?? r).join(', ')}</div></td><td className="px-4 py-3">{REASON_LABEL[b.reason_code] ?? b.reason_code}</td><td className="px-4 py-3 max-w-xs">{b.note}</td><td className="px-4 py-3">{b.lifted_at ? `Lifted ${when(b.lifted_at)}` : b.ends_at ? when(b.ends_at) : 'Until review'}</td><td className="px-4 py-3">{b.blocked_by_name ?? '—'}<div className="text-sub">{when(b.created_at)}</div></td><td className="px-4 py-3 text-right"><Link to={`/users/${b.user_id}`} className="font-bold text-brand">Open ›</Link></td></tr>
            ))}</tbody></table>
        )}
      </Card>
    </div>
  );
}

// ---------- Staff ----------
export function Staff() {
  const [d, setD] = useState<Awaited<ReturnType<typeof control.staff>> | null>(null);
  const [f, setF] = useState({ phone: '', name: '', role: 'ops_admin' });
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { control.staff().then(setD).catch(e => setErr(msg(e))); }, []);
  useEffect(() => { load(); }, [load]);
  async function add(e: React.FormEvent) { e.preventDefault(); setErr(null); try { await control.addStaff({ phone: f.phone, role: f.role, name: f.name || undefined }); setF({ ...f, phone: '', name: '' }); load(); } catch (x) { setErr(msg(x)); } }
  return (
    <div className="flex flex-col gap-5 max-w-5xl">
      <Header kicker="People" title="Staff & roles" />
      <p className="text-sm text-sub">Give someone a staff role by their mobile number; they sign in to this console with OTP. Super admin is set only on the server and can’t be given here.</p>
      <Card>
        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_220px_auto] gap-3">
          <input required placeholder="Mobile number" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className={input} />
          <input placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={input} />
          <select value={f.role} onChange={e => setF({ ...f, role: e.target.value })} className={input}>{d?.roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}</select>
          <Btn tone="brand">Give role</Btn>
        </form>
      </Card>
      <Err e={err} />
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-canvas text-sub text-left"><tr>{['Name', 'Roles', 'Last sign-in', 'Status'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{d?.staff.map(s => (
            <tr key={s.id} className="border-t border-line"><td className="px-4 py-3"><Link to={`/users/${s.id}`} className="font-bold text-brand">{s.name ?? '—'}</Link><div className="text-sub">{s.phone}</div></td>
              <td className="px-4 py-3"><div className="flex gap-2 flex-wrap">{s.roles.map(r => (
                <span key={r} className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-3 py-1 font-semibold">{ROLE_LABEL[r] ?? r}
                  {r !== 'super_admin' && <button aria-label={`Remove ${ROLE_LABEL[r]}`} className="text-danger-ink font-bold" onClick={async () => { if (!window.confirm(`Remove ${ROLE_LABEL[r]} from ${s.name ?? s.phone}?`)) return; try { await control.removeRole(s.id, r); load(); } catch (x) { setErr(msg(x)); } }}>×</button>}
                </span>))}</div></td>
              <td className="px-4 py-3">{when(s.last_login_at)}</td><td className="px-4 py-3 capitalize">{s.status}</td></tr>
          ))}</tbody></table>
      </Card>
    </div>
  );
}

// ---------- Zones ----------
export function Zones({ isSuper }: { isSuper: boolean }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof control.zones>> | null>(null);
  const [edit, setEdit] = useState<Zone | null>(null);
  const [form, setForm] = useState({ color: '', reason: '', radiusKm: '', centerLat: '', centerLng: '', reviewOn: '' });
  const [adding, setAdding] = useState(false);
  const [nz, setNz] = useState({ cityId: '', name: '', color: 'blue', reason: '', centerLat: '', centerLng: '', radiusKm: '1.5' });
  const [history, setHistory] = useState<Awaited<ReturnType<typeof control.zoneHistory>>['changes'] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { control.zones().then(setD).catch(e => setErr(msg(e))); }, []);
  useEffect(() => { load(); }, [load]);
  function open(z: Zone) {
    setEdit(z); setHistory(null);
    setForm({ color: z.color, reason: '', radiusKm: String(z.radius_km ?? ''), centerLat: String(z.center_lat ?? ''), centerLng: String(z.center_lng ?? ''), reviewOn: z.review_on?.slice(0, 10) ?? '' });
    control.zoneHistory(z.id).then(r => setHistory(r.changes)).catch(() => undefined);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return; setErr(null);
    try {
      await control.updateZone(edit.id, { color: form.color, reason: form.reason, radiusKm: Number(form.radiusKm) || undefined, centerLat: Number(form.centerLat) || undefined, centerLng: Number(form.centerLng) || undefined, reviewOn: form.reviewOn || null });
      setEdit(null); load();
    } catch (x) { setErr(msg(x)); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try { await control.addZone({ ...nz, centerLat: Number(nz.centerLat), centerLng: Number(nz.centerLng), radiusKm: Number(nz.radiusKm) }); setAdding(false); load(); } catch (x) { setErr(msg(x)); }
  }
  const cities = [...new Set(d?.zones.map(z => z.city))];
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Service area" title="Zones" right={<Btn tone="brand" onClick={() => { setAdding(a => !a); setNz({ ...nz, cityId: d?.cities.find(c => c.name === 'Patna')?.id ?? '' }); }}>{adding ? 'Close' : 'Add zone'}</Btn>} />
      <div className="flex gap-2 flex-wrap">{Object.keys(ZONE_MEANING).map(c => <ZonePill key={c} color={c} />)}</div>
      <p className="text-sm text-sub">Colour sets what patients can book. Home-visit hours per colour are in the server .env (ZONE_HOURS_*). Every change needs a reason and is kept. Only a super admin can turn a zone Red.</p>
      <Err e={err} />
      {adding && d && (
        <Card>
          <form onSubmit={create} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select value={nz.cityId} onChange={e => setNz({ ...nz, cityId: e.target.value })} className={input}>{d.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input required placeholder="Zone name" value={nz.name} onChange={e => setNz({ ...nz, name: e.target.value })} className={input} />
            <select value={nz.color} onChange={e => setNz({ ...nz, color: e.target.value })} className={input}>{d.colors.filter(c => isSuper || c !== 'red').map(c => <option key={c} value={c}>{c} · {ZONE_MEANING[c]}</option>)}</select>
            <input required placeholder="Centre latitude (25.61)" value={nz.centerLat} onChange={e => setNz({ ...nz, centerLat: e.target.value })} className={input} />
            <input required placeholder="Centre longitude (85.14)" value={nz.centerLng} onChange={e => setNz({ ...nz, centerLng: e.target.value })} className={input} />
            <input required placeholder="Radius km" value={nz.radiusKm} onChange={e => setNz({ ...nz, radiusKm: e.target.value })} className={input} />
            <input required minLength={3} placeholder="Reason" value={nz.reason} onChange={e => setNz({ ...nz, reason: e.target.value })} className={`${input} md:col-span-2`} />
            <Btn tone="brand">Add zone</Btn>
          </form>
        </Card>
      )}
      {edit && (
        <Card className="border-brand">
          <form onSubmit={save} className="flex flex-col gap-3">
            <div className="flex justify-between flex-wrap gap-2"><p className="text-lg font-extrabold">{edit.name} · {edit.city}</p><button type="button" onClick={() => setEdit(null)} className="text-sub font-bold">Close</button></div>
            {edit.upcoming > 0 && <p className="text-sm font-semibold text-warning-ink">{edit.upcoming} upcoming visit(s) here. Changing to Red stops new bookings; existing visits stay and should be reviewed.</p>}
            <div className="flex gap-2 flex-wrap">{d?.colors.map(c => (
              <button type="button" key={c} disabled={c === 'red' && !isSuper && edit.color !== 'red'} onClick={() => setForm({ ...form, color: c })}
                className={`h-10 px-4 rounded-full text-sm font-bold capitalize disabled:opacity-40 ${form.color === c ? 'ring-2 ring-navy' : ''}`} style={{ background: ZONE_BG[c], color: ZONE_INK[c] }}>{c}</button>
            ))}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="text-sm text-sub font-semibold flex flex-col gap-1">Centre lat<input value={form.centerLat} onChange={e => setForm({ ...form, centerLat: e.target.value })} className={input} /></label>
              <label className="text-sm text-sub font-semibold flex flex-col gap-1">Centre lng<input value={form.centerLng} onChange={e => setForm({ ...form, centerLng: e.target.value })} className={input} /></label>
              <label className="text-sm text-sub font-semibold flex flex-col gap-1">Radius km<input value={form.radiusKm} onChange={e => setForm({ ...form, radiusKm: e.target.value })} className={input} /></label>
              <label className="text-sm text-sub font-semibold flex flex-col gap-1">Review on<input type="date" value={form.reviewOn} onChange={e => setForm({ ...form, reviewOn: e.target.value })} className={input} /></label>
            </div>
            <input required minLength={3} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Reason for this change (required)" className={input} />
            <div><Btn tone="brand">Save</Btn></div>
            {edit.center_lat && <a className="text-sm text-brand font-bold" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${edit.center_lat},${edit.center_lng}`}>See centre on Google Maps ›</a>}
            {history && <div className="text-sm flex flex-col gap-1 border-t border-line pt-3"><p className="font-bold">History</p>{history.map((h, i) => <p key={i}>{when(h.created_at)} · {h.from_color ?? 'new'} → <b>{h.to_color}</b> · {h.reason} · {h.changed_by ?? '—'}</p>)}</div>}
          </form>
        </Card>
      )}
      {cities.map(city => (
        <section key={city} className="flex flex-col gap-2">
          <h2 className="font-extrabold">{city}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {d!.zones.filter(z => z.city === city).map(z => (
              <button key={z.id} onClick={() => open(z)} className="text-left rounded-card bg-white border border-line p-4 flex flex-col gap-2 hover:border-brand">
                <div className="flex justify-between gap-2"><span className="font-extrabold">{z.name}</span><ZonePill color={z.color} /></div>
                <span className="text-sm text-sub">{z.radius_km ? `${z.radius_km} km radius` : 'No area set'} · {z.upcoming} upcoming visits</span>
                {z.reason && <span className="text-sm">{z.reason}</span>}
                {z.review_on && <span className="text-xs text-sub">Review on {z.review_on.slice(0, 10)}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------- Grievances ----------
const CAT_LABEL: Record<string, string> = { service: 'Service', physio_conduct: 'Physio conduct', safety: 'Safety', harassment: 'Harassment', payment: 'Payment', refund: 'Refund', privacy: 'Privacy', app: 'App', other: 'Other' };
const dueIn = (iso: string) => { const h = Math.round((new Date(iso).getTime() - Date.now()) / 36e5); return h < 0 ? `${-h < 48 ? `${-h} h` : `${Math.round(-h / 24)} days`} late` : h < 48 ? `in ${h} h` : `in ${Math.round(h / 24)} days`; };
export function Grievances() {
  const [status, setStatus] = useState('active');
  const [d, setD] = useState<Awaited<ReturnType<typeof grievances.list>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD(null); grievances.list(status).then(setD).catch(e => setErr(msg(e))); }, [status]);
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Grievance redressal" title="Grievances" right={<Tabs value={status} onChange={setStatus} options={[['active', 'Open'], ['resolved', 'Resolved'], ['rejected', 'Closed'], ['all', 'All']]} />} />
      {d && <p className="text-sm text-sub">Grievance Officer: <b>{d.officer.name}</b>{d.officer.email ? ` · ${d.officer.email}` : ' · email not set (GRIEVANCE_OFFICER_EMAIL)'}. Acknowledge within {d.officer.ackHours} h, resolve within {d.officer.resolveDays} days. Harassment and safety complaints are seen only by the committee and super admin.</p>}
      <Err e={err} />
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-canvas text-sub text-left"><tr>{['Ticket', 'Category', 'From', 'About', 'Status', 'Due', ''].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {d === null && <tr><td colSpan={7} className="px-4 py-6 text-sub">Loading…</td></tr>}
            {d?.grievances.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-sub">Nothing here.</td></tr>}
            {d?.grievances.map((g: GrievanceRow) => (
              <tr key={g.id} className={`border-t border-line ${g.overdue ? 'bg-danger/5' : ''}`}>
                <td className="px-4 py-3 font-mono font-bold">{g.ticket_no}{g.committee && <span className="ml-2 rounded-full bg-violet/15 text-violet px-2 py-0.5 text-xs font-sans">Committee</span>}</td>
                <td className="px-4 py-3">{CAT_LABEL[g.category] ?? g.category}</td>
                <td className="px-4 py-3">{g.complainant_name ?? '—'}</td>
                <td className="px-4 py-3">{g.against_name ?? '—'}</td>
                <td className="px-4 py-3 capitalize">{g.status.replace('_', ' ')}{g.assigned_name ? ` · ${g.assigned_name}` : ''}</td>
                <td className={`px-4 py-3 ${g.overdue ? 'font-bold text-danger-ink' : ''}`}>{['resolved', 'rejected'].includes(g.status) ? when(g.resolved_at) : !g.acknowledged_at ? `Ack ${dueIn(g.ack_due_at)}` : `Resolve ${dueIn(g.resolve_due_at)}`}</td>
                <td className="px-4 py-3 text-right"><Link to={`/grievances/${g.id}`} className="font-bold text-brand">Open ›</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function GrievanceDetail() {
  const { id = '' } = useParams();
  const [d, setD] = useState<Awaited<ReturnType<typeof grievances.get>> | null>(null);
  const [committee, setCommittee] = useState<{ id: string; name: string | null }[]>([]);
  const [text, setText] = useState('');
  const [toComplainant, setToComplainant] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { grievances.get(id).then(setD).catch(e => setErr(msg(e))); }, [id]);
  useEffect(() => { load(); grievances.list('all').then(r => setCommittee(r.committee)).catch(() => undefined); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); setText(''); load(); } catch (e) { setErr(msg(e)); } };
  if (!d) return <div><Header title="Grievance" /><Err e={err} /></div>;
  const g = d.grievance;
  const open = !['resolved', 'rejected'].includes(g.status);
  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <Header kicker={`${CAT_LABEL[g.category] ?? g.category}${g.committee ? ' · Committee only' : ''}`} title={g.ticket_no} right={<span className="rounded-full bg-canvas px-3 py-1 text-sm font-bold capitalize">{g.status.replace('_', ' ')}</span>} />
      <Card className="flex flex-col gap-2">
        <p className="text-sm"><span className="text-sub">From</span> <b>{g.complainant_name ?? '—'}</b> {g.complainant_phone}{g.against_name ? <> · <span className="text-sub">about</span> <b>{g.against_name}</b> {g.against_phone}</> : null}</p>
        <p className="text-sm text-sub">Filed {when(g.created_at)} · acknowledge by {when(g.ack_due_at)} · resolve by {when(g.resolve_due_at)}</p>
        <p className="whitespace-pre-wrap">{g.description}</p>
        {g.file_ids.length > 0 && <p className="text-sm text-sub">{g.file_ids.length} attachment(s)</p>}
        {g.resolution && <p className="rounded-xl bg-success/10 px-4 py-3"><b>Outcome:</b> {g.resolution}</p>}
      </Card>
      <Err e={err} />
      {open && (
        <div className="flex gap-2 flex-wrap items-center">
          {!g.acknowledged_at && <Btn tone="brand" onClick={() => act(() => grievances.acknowledge(id))}>Acknowledge</Btn>}
          <select defaultValue="" onChange={e => e.target.value && act(() => grievances.assign(id, e.target.value))} className={input}><option value="">Assign to…</option>{committee.map(c => <option key={c.id} value={c.id}>{c.name ?? c.id}</option>)}</select>
          {!g.committee && <Btn tone="ghost" onClick={() => { const r = window.prompt('Why send this to the grievance committee?'); if (r && r.trim().length >= 5) act(() => grievances.escalate(id, r.trim())); }}>Send to committee</Btn>}
        </div>
      )}
      <h2 className="text-xl font-extrabold">Timeline</h2>
      <div className="flex flex-col gap-2">
        {d.events.map(e => (
          <div key={e.id} className={`rounded-xl px-4 py-3 text-sm ${e.public ? 'bg-brand/5 border border-brand/20' : 'bg-white border border-line'}`}>
            <p className="text-xs text-sub font-semibold">{when(e.created_at)} · {e.actor_name ?? '—'} · {e.kind}{e.public ? ' · seen by complainant' : ' · internal'}</p>
            {e.body && <p className="whitespace-pre-wrap mt-1">{e.body}</p>}
          </div>
        ))}
      </div>
      {open && (
        <Card className="flex flex-col gap-3">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="Write a note, a reply to the complainant, or the final outcome" className="rounded-xl border border-line p-3" />
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={toComplainant} onChange={e => setToComplainant(e.target.checked)} className="w-4 h-4" />Send to the complainant</label>
          <div className="flex gap-2 flex-wrap">
            <Btn tone="ghost" disabled={text.trim().length < 2} onClick={() => act(() => grievances.note(id, text.trim(), toComplainant))}>{toComplainant ? 'Send reply' : 'Add internal note'}</Btn>
            <Btn tone="brand" disabled={text.trim().length < 10} onClick={() => window.confirm('Resolve and close? The outcome is sent to the complainant.') && act(() => grievances.resolve(id, text.trim()))}>Resolve with this outcome</Btn>
            <Btn tone="danger" disabled={text.trim().length < 10} onClick={() => window.confirm('Close without action? The reason is sent to the complainant.') && act(() => grievances.resolve(id, text.trim(), true))}>Close, no action</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- Platform settings ----------
export function PlatformSettings({ isSuper }: { isSuper: boolean }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof control.settings>> | null>(null);
  const [m, setM] = useState({ enabled: false, message: '' });
  const [v, setV] = useState<Record<string, string>>({});
  const [s, setS] = useState<Scheduling | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => { control.settings().then(x => { setD(x); setM({ enabled: x.maintenance.enabled, message: x.maintenance.message ?? '' }); setV(x.min_app_version); setS(x.scheduling); }).catch(e => setErr(msg(e))); }, []);
  const run = async (label: string, fn: () => Promise<unknown>) => { setErr(null); setOk(null); try { await fn(); setOk(`${label} saved.`); } catch (e) { setErr(msg(e)); } };
  if (!d || !s) return <div><Header title="Platform settings" /><Err e={err} /></div>;
  const num = (label: string, value: number, on: (n: number) => void) => (
    <label className="text-sm text-sub font-semibold flex flex-col gap-1">{label}<input disabled={!isSuper} type="number" min={0} value={value} onChange={e => on(Number(e.target.value))} className={`${input} disabled:bg-canvas`} /></label>
  );
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <Header kicker="Super admin" title="Platform settings" />
      {!isSuper && <p className="text-sm text-sub">Only a super admin can change these.</p>}
      <p className="text-sm text-sub">Starting values come from the server .env (see apps/api/.env.example). Changes here take effect at once and are audit-logged.</p>
      {ok && <p className="text-sm font-semibold text-success-ink">{ok}</p>}
      <Err e={err} />
      <Card className="flex flex-col gap-3">
        <p className="font-extrabold">Maintenance mode</p>
        <p className="text-sm text-sub">Every app shows a banner. Booked visits are not affected.</p>
        <label className="flex items-center gap-2 font-semibold"><input disabled={!isSuper} type="checkbox" checked={m.enabled} onChange={e => setM({ ...m, enabled: e.target.checked })} className="w-5 h-5" />Maintenance on</label>
        <input disabled={!isSuper} value={m.message} onChange={e => setM({ ...m, message: e.target.value })} placeholder="Message shown to users, e.g. Upgrading till 2 AM" className={`${input} disabled:bg-canvas`} />
        {isSuper && <div><Btn tone={m.enabled ? 'danger' : 'dark'} onClick={() => run('Maintenance', () => control.setMaintenance(m.enabled, m.message.trim() || null))}>Save</Btn></div>}
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="font-extrabold">Minimum app versions</p>
        <p className="text-sm text-sub">Older apps are asked to update before they can continue.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Object.keys(v).map(k => (
          <label key={k} className="text-sm text-sub font-semibold flex flex-col gap-1 capitalize">{k.replace('_', ' ')}<input disabled={!isSuper} value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} className={`${input} disabled:bg-canvas`} /></label>
        ))}</div>
        {isSuper && <div><Btn onClick={() => run('App versions', () => control.setMinVersions(v))}>Save</Btn></div>}
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="font-extrabold">Scheduling</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {num('Home visit (min)', s.visitMinutes.home, n => setS({ ...s, visitMinutes: { ...s.visitMinutes, home: n } }))}
          {num('Video visit (min)', s.visitMinutes.video, n => setS({ ...s, visitMinutes: { ...s.visitMinutes, video: n } }))}
          {num('Clinic visit (min)', s.visitMinutes.clinic, n => setS({ ...s, visitMinutes: { ...s.visitMinutes, clinic: n } }))}
          {num('Travel buffer (min)', s.travelBufferMinutes, n => setS({ ...s, travelBufferMinutes: n }))}
          {num('Book up to (days ahead)', s.bookingWindowDays, n => setS({ ...s, bookingWindowDays: n }))}
          {num('Minimum notice (hours)', s.minNoticeHours, n => setS({ ...s, minNoticeHours: n }))}
          {num('Slot hold while paying (min)', s.paymentHoldMinutes, n => setS({ ...s, paymentHoldMinutes: n }))}
          {num('Max visits per physio per day', s.maxVisitsPerDay, n => setS({ ...s, maxVisitsPerDay: n }))}
          {num('Free reschedule up to (hours before)', s.freeRescheduleHours, n => setS({ ...s, freeRescheduleHours: n }))}
        </div>
        {isSuper && <div><Btn onClick={() => run('Scheduling', () => control.setScheduling(s))}>Save as new version</Btn></div>}
      </Card>
    </div>
  );
}

// ---------- Audit log ----------
export function AuditLog() {
  const [action, setAction] = useState('');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof control.audit>>['entries']>([]);
  const [more, setMore] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => control.audit({ action }).then(r => { setRows(r.entries); setMore(r.entries.length === 100); }).catch(e => setErr(msg(e))), 250); return () => clearTimeout(t); }, [action]);
  const loadMore = () => control.audit({ action, before: rows[rows.length - 1]?.id }).then(r => { setRows(x => [...x, ...r.entries]); setMore(r.entries.length === 100); }).catch(e => setErr(msg(e)));
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Super admin" title="Audit log" />
      <input value={action} onChange={e => setAction(e.target.value)} placeholder="Filter by action, e.g. block, payment, zone, refund" className={`${input} max-w-md`} />
      <Err e={err} />
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-canvas text-sub text-left"><tr>{['When', 'Who', 'Action', 'Target', ''].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{rows.map(r => (
            <Fragment key={r.id}>
              <tr className="border-t border-line"><td className="px-4 py-2 whitespace-nowrap">{when(r.created_at)}</td><td className="px-4 py-2">{r.actor_name ?? (r.actor_phone || 'System')}</td><td className="px-4 py-2 font-mono">{r.action}</td><td className="px-4 py-2">{r.target_type ?? ''} <span className="text-sub font-mono text-xs">{r.target_id?.slice(0, 8)}</span></td>
                <td className="px-4 py-2 text-right"><button onClick={() => setOpen(open === r.id ? null : r.id)} className="text-brand font-bold">{open === r.id ? 'Hide' : 'Details'}</button></td></tr>
              {open === r.id && <tr><td colSpan={5} className="px-4 pb-3"><pre className="bg-canvas rounded-xl p-3 text-xs overflow-x-auto">{JSON.stringify({ before: r.before, after: r.after, ip: r.ip }, null, 2)}</pre></td></tr>}
            </Fragment>
          ))}</tbody></table>
      </Card>
      {more && rows.length > 0 && <div><Btn tone="ghost" onClick={loadMore}>Load older</Btn></div>}
    </div>
  );
}
