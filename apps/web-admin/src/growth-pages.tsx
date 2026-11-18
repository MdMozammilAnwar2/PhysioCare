import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, growth, PARTNER_TYPE_LABEL, rupees, when, type Attribution, type GrowthRules, type PartnerRow } from './api';
import { Header } from './pages';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <section className={`rounded-card bg-white border border-line p-5 ${className}`}>{children}</section>;
const Btn = ({ tone = 'dark', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'dark' | 'brand' | 'ghost' | 'danger' }) => (
  <button {...p} className={`h-10 px-4 rounded-xl font-bold text-sm disabled:opacity-50 ${{ dark: 'bg-navy text-white', brand: 'bg-brand text-white', ghost: 'bg-white border border-line', danger: 'bg-white border border-danger/40 text-danger-ink' }[tone]} ${p.className ?? ''}`} />
);
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="text-sm font-semibold text-danger-ink">{e}</p> : null);
const input = 'h-11 rounded-xl border border-line px-3 text-ink text-base';
function Tabs({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return <div className="flex gap-2 flex-wrap">{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={`h-10 px-4 rounded-full text-sm font-bold ${value === v ? 'bg-navy text-white' : 'bg-white border border-line'}`}>{l}</button>)}</div>;
}
const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => <div className="rounded-xl bg-canvas px-4 py-3"><p className="text-xs text-sub font-semibold">{label}</p><p className="text-xl font-extrabold">{value}</p></div>;

function AddPartner({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: '', type: 'doctor', phone: '', contactName: '', registrationNo: '', address: '', payoutTo: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
    try { await growth.createPartner(body); onDone(); } catch (x) { setErr(msg(x)); } finally { setBusy(false); }
  }
  return (
    <Card>
      <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <p className="md:col-span-2 font-extrabold">Add a partner (approved at once, QR created)</p>
        <input required placeholder="Name (Dr Sinha Ortho Clinic)" value={f.name} onChange={set('name')} className={input} />
        <select value={f.type} onChange={set('type')} className={input}>{Object.entries(PARTNER_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input required placeholder="Owner’s mobile number" inputMode="tel" value={f.phone} onChange={set('phone')} className={input} />
        <input placeholder="Contact person" value={f.contactName} onChange={set('contactName')} className={input} />
        <input placeholder="Registration no. (council / hospital / lab)" value={f.registrationNo} onChange={set('registrationNo')} className={input} />
        <input placeholder="Pay rewards to (UPI ID or bank + IFSC)" value={f.payoutTo} onChange={set('payoutTo')} className={input} />
        <input placeholder="Address" value={f.address} onChange={set('address')} className={`${input} md:col-span-2`} />
        <div className="md:col-span-2 flex gap-3 items-center"><Btn tone="brand" disabled={busy}>Add partner</Btn><Err e={err} /></div>
      </form>
    </Card>
  );
}

export function Partners({ canAdd }: { canAdd: boolean }) {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<PartnerRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setRows(null); growth.partners(status).then(r => setRows(r.partners)).catch(e => setErr(msg(e))); }, [status]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Growth" title="Partners" right={<div className="flex gap-2 items-center flex-wrap">
        <Tabs value={status} onChange={setStatus} options={[['pending', 'To review'], ['approved', 'Active'], ['suspended', 'Suspended'], ['rejected', 'Rejected']]} />
        {canAdd && <Btn tone="brand" onClick={() => setAdding(a => !a)}>{adding ? 'Close' : 'Add partner'}</Btn>}
      </div>} />
      <p className="text-sm text-sub">Doctors, hospitals, clinics, labs, physiotherapists and others who send patients. Each gets QR codes; they earn a reward on each new patient’s first paid visit.</p>
      {adding && <AddPartner onDone={() => { setAdding(false); setStatus('approved'); load(); }} />}
      <Err e={err} />
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-sub text-left"><tr>{['Partner', 'Type', 'Joined', 'Sign-ups', 'Paid', 'Reward due', ''].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={7} className="px-4 py-6 text-sub">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-sub">Nothing here.</td></tr>}
            {rows?.map(p => (
              <tr key={p.id} className="border-t border-line">
                <td className="px-4 py-3"><div className="font-bold">{p.name}</div><div className="text-sub">{p.contact_name ?? ''} {p.phone}</div></td>
                <td className="px-4 py-3">{PARTNER_TYPE_LABEL[p.type] ?? p.type}</td>
                <td className="px-4 py-3">{when(p.created_at)}</td>
                <td className="px-4 py-3">{p.signups}</td>
                <td className="px-4 py-3">{p.paid}</td>
                <td className="px-4 py-3 font-bold">{p.due_paise ? rupees(p.due_paise) : '—'}</td>
                <td className="px-4 py-3 text-right"><Link to={`/partners/${p.id}`} className="font-bold text-brand">Open ›</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function QrImage({ path, label }: { path: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let url: string | null = null; fetch(`/api/v1${path.replace('/api/v1', '')}`, { headers: { authorization: `Bearer ${sessionStorage.getItem('pc.access')}` } }).then(r => r.blob()).then(b => { url = URL.createObjectURL(b); setSrc(url); }).catch(() => undefined); return () => { if (url) URL.revokeObjectURL(url); }; }, [path]);
  if (!src) return <div className="w-40 h-40 bg-canvas rounded-xl" />;
  return <a href={src} download={`PhysioCare-${label}.png`} title="Download"><img src={src} alt={`QR code: ${label}`} className="w-40 h-40 rounded-xl border border-line" /></a>;
}

export function PartnerDetail({ canDecide, canPay }: { canDecide: boolean; canPay: boolean }) {
  const { id = '' } = useParams();
  const [d, setD] = useState<Awaited<ReturnType<typeof growth.partner>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { growth.partner(id).then(setD).catch(e => setErr(msg(e))); }, [id]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); load(); } catch (e) { setErr(msg(e)); } };
  if (!d) return <div><Header title="Partner" /><Err e={err} /></div>;
  const p = d.partner;
  const reward = p.reward_paise ?? d.defaultRewardPaise;
  return (
    <div className="flex flex-col gap-5">
      <Header kicker={`${PARTNER_TYPE_LABEL[p.type] ?? p.type} · ${String(p.phone ?? '')}`} title={p.name} right={<span className="rounded-full bg-canvas px-3 py-1 text-sm font-bold capitalize">{p.status}</span>} />
      <Err e={err} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Reward per new patient" value={rupees(reward)} />
        <Stat label="Sign-ups" value={d.links.reduce((a, l) => a + l.signups, 0)} />
        <Stat label="Reward due" value={rupees(d.earnedPaise)} />
        <Stat label="Paid so far" value={rupees(d.paidPaise)} />
      </div>
      <Card className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        <p><span className="text-sub">Contact:</span> {String(p.contact_name ?? '—')}</p>
        <p><span className="text-sub">Registration:</span> {String(p.registration_no ?? '—')}</p>
        <p><span className="text-sub">Pay to:</span> <b>{String(p.payout_to ?? 'not given')}</b></p>
        <p><span className="text-sub">Address:</span> {String(p.address ?? '—')}</p>
        {p.decision_note && <p className="md:col-span-2"><span className="text-sub">Note:</span> {String(p.decision_note)}</p>}
      </Card>
      <div className="flex gap-2 flex-wrap">
        {canDecide && p.status !== 'approved' && <Btn tone="brand" onClick={() => { const r = window.prompt(`Reward per new patient in ₹ (blank = default ${rupees(d.defaultRewardPaise)})`, ''); if (r === null) return; act(() => growth.decide(id, { approve: true, rewardPaise: r.trim() ? Math.round(Number(r) * 100) : undefined })); }}>Approve</Btn>}
        {canDecide && p.status !== 'rejected' && p.status !== 'suspended' && <Btn tone="danger" onClick={() => { const n = window.prompt(p.status === 'pending' ? 'Reason for rejecting (sent to them)' : 'Reason for suspending (their QR codes stop working)'); if (n?.trim()) act(() => growth.decide(id, { approve: false, note: n })); }}>{p.status === 'pending' ? 'Reject' : 'Suspend'}</Btn>}
        {canPay && d.earnedPaise > 0 && <Btn tone="dark" onClick={() => { const ref = window.prompt(`Send ${rupees(d.earnedPaise)} to ${String(p.payout_to ?? 'the partner')}, then enter the transfer reference (UTR)`); if (ref?.trim()) act(() => growth.payRewards(id, ref.trim())); }}>Mark {rupees(d.earnedPaise)} paid</Btn>}
      </div>
      <h2 className="text-xl font-extrabold">QR codes</h2>
      {d.links.length === 0 && <p className="text-sub">Created when the partner is approved.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {d.links.map(l => (
          <Card key={l.id} className="flex gap-4 items-start">
            <QrImage path={l.qrUrl} label={l.meta?.label ?? l.code} />
            <div className="text-sm flex flex-col gap-1">
              <p className="font-extrabold">{l.meta?.label ?? 'QR'}</p>
              <p className="font-mono">{l.code}</p>
              <p className="text-sub">{l.scans} scans · {l.clicks} clicks</p>
              <p className="text-sub">{l.signups} sign-ups · {l.paid} paid</p>
              {!l.active && <p className="text-danger-ink font-bold">Inactive</p>}
              <button onClick={() => navigator.clipboard.writeText(l.url)} className="text-left text-brand font-bold">Copy link</button>
            </div>
          </Card>
        ))}
      </div>
      <h2 className="text-xl font-extrabold">Rewards</h2>
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-sub text-left"><tr>{['Date', 'QR', 'Amount', 'Status'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {d.rewards.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-sub">No rewards yet.</td></tr>}
            {d.rewards.map(r => <tr key={r.id} className="border-t border-line"><td className="px-4 py-3">{when(r.created_at)}</td><td className="px-4 py-3">{r.label ?? '—'}</td><td className="px-4 py-3 font-bold">{rupees(r.amount_paise)}</td><td className="px-4 py-3">{r.status === 'paid' ? `Paid · ${r.reference}` : r.status}</td></tr>)}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { partner_permanent_qr: 'Partner QR', hospital_qr: 'Hospital QR (doctor)', friend_link: 'Friend referral', physio_link: 'Physio link', campaign: 'Campaign (UTM)', organic: 'Direct / organic', self_reported: 'Told us' };
export function GrowthReport() {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [d, setD] = useState<Attribution | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { growth.attribution(from, to).then(setD).catch(e => setErr(msg(e))); }, [from, to]);
  const total = d?.bySource.reduce((a, s) => a + s.signups, 0) ?? 0;
  const paid = d?.bySource.reduce((a, s) => a + s.paid, 0) ?? 0;
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Growth" title="Where patients come from" right={<div className="flex gap-2 items-center">
        <label className="text-sm text-sub">From <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-10 rounded-xl border border-line px-2" /></label>
        <label className="text-sm text-sub">To <input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-10 rounded-xl border border-line px-2" /></label></div>} />
      <Err e={err} />
      {d && <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Sign-ups" value={total} />
          <Stat label="Became paying" value={`${paid} (${total ? Math.round((100 * paid) / total) : 0}%)`} />
          <Stat label="Coins issued" value={`${d.coins.issued.toLocaleString('en-IN')} (${rupees(d.coins.issued * 10)})`} />
          <Stat label="Coins redeemed" value={`${d.coins.redeemed.toLocaleString('en-IN')} (${rupees(d.coins.redeemed * 10)})`} />
        </div>
        <Card>
          <p className="font-extrabold mb-3">By source</p>
          <div className="flex flex-col gap-2">
            {d.bySource.length === 0 && <p className="text-sub">No sign-ups in this period.</p>}
            {d.bySource.map(s => (
              <div key={s.source} className="grid grid-cols-[160px_1fr_auto] gap-3 items-center text-sm">
                <span className="font-semibold">{SOURCE_LABEL[s.source] ?? s.source}</span>
                <div className="h-3 rounded-full bg-canvas overflow-hidden"><div className="h-full bg-brand" style={{ width: `${total ? (100 * s.signups) / total : 0}%` }} /></div>
                <span className="tabular-nums">{s.signups} · {s.paid} paid{s.flagged ? ` · ${s.flagged} flagged` : ''}</span>
              </div>
            ))}
          </div>
        </Card>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card className="p-0 overflow-x-auto">
            <p className="font-extrabold px-5 pt-4 pb-2">Top partners</p>
            <table className="w-full text-sm"><thead className="bg-canvas text-sub text-left"><tr>{['Partner', 'Sign-ups', 'Paid', 'Rewards'].map(h => <th key={h} className="px-4 py-2 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{d.partners.length === 0 ? <tr><td colSpan={4} className="px-4 py-4 text-sub">None yet.</td></tr> : d.partners.map(p => <tr key={p.id} className="border-t border-line"><td className="px-4 py-2"><Link to={`/partners/${p.id}`} className="font-bold text-brand">{p.name}</Link><div className="text-sub">{PARTNER_TYPE_LABEL[p.type] ?? p.type}</div></td><td className="px-4 py-2">{p.signups}</td><td className="px-4 py-2">{p.paid}</td><td className="px-4 py-2">{rupees(p.reward_paise)}</td></tr>)}</tbody></table>
          </Card>
          <Card className="p-0 overflow-x-auto">
            <p className="font-extrabold px-5 pt-4 pb-2">Top patient referrers</p>
            <table className="w-full text-sm"><thead className="bg-canvas text-sub text-left"><tr>{['Patient', 'Friends joined', 'Booked'].map(h => <th key={h} className="px-4 py-2 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{d.referrers.length === 0 ? <tr><td colSpan={3} className="px-4 py-4 text-sub">None yet.</td></tr> : d.referrers.map(r => <tr key={r.id} className="border-t border-line"><td className="px-4 py-2"><b>{r.name ?? '—'}</b><div className="text-sub">{r.phone}</div></td><td className="px-4 py-2">{r.signups}</td><td className="px-4 py-2">{r.paid}</td></tr>)}</tbody></table>
          </Card>
        </div>
      </>}
    </div>
  );
}

export function GrowthRulesPage({ canEdit }: { canEdit: boolean }) {
  const [r, setR] = useState<GrowthRules | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [adj, setAdj] = useState({ phone: '', delta: '', note: '' });
  const [adjMsg, setAdjMsg] = useState<string | null>(null);
  useEffect(() => { growth.rules().then(x => setR(x.rules)).catch(e => setErr(msg(e))); }, []);
  if (!r) return <div><Header title="Coins & rewards" /><Err e={err} /></div>;
  const field = (k: keyof GrowthRules, label: string, hint: string, scale = 1) => (
    <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">{label}
      <input disabled={!canEdit} type="number" min={0} value={r[k] / scale} onChange={e => { setSaved(false); setR({ ...r, [k]: Math.round(Number(e.target.value) * scale) }); }} className={`${input} disabled:bg-canvas`} />
      <span className="font-normal text-xs">{hint}</span>
    </label>
  );
  async function save() { setErr(null); try { await growth.saveRules(r!); setSaved(true); } catch (e) { setErr(msg(e)); } }
  async function adjust(e: React.FormEvent) {
    e.preventDefault(); setAdjMsg(null);
    try { await growth.adjustCoins(adj.phone, Number(adj.delta), adj.note); setAdjMsg('Done.'); setAdj({ phone: '', delta: '', note: '' }); } catch (x) { setAdjMsg(msg(x)); }
  }
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <Header kicker="Growth" title="Coins & rewards" />
      <p className="text-sm text-sub">10 coins = ₹1. Coins are given only once per person and event; flagged sign-ups get nothing.</p>
      <Card className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field('welcomeCoins', 'Welcome coins', `New patient who joins through any link or QR. Now ₹${r.welcomeCoins / 10}.`)}
        {field('referrerCoins', 'Referrer coins', `To the patient who shared the link, when their friend’s first visit is paid. Now ₹${r.referrerCoins / 10}.`)}
        {field('maxCoinPct', 'Coins can pay up to (%)', 'Of a booking’s price. The physio still earns on the full price.')}
        {field('partnerRewardPaise', 'Partner reward (₹)', 'Per new patient’s first paid visit. Can be set per partner when approving.', 100)}
      </Card>
      <Err e={err} />
      {canEdit ? <div className="flex gap-3 items-center"><Btn tone="brand" onClick={save}>Save</Btn>{saved && <span className="text-sm text-success-ink font-semibold">Saved.</span>}</div> : <p className="text-sm text-sub">Only a super admin can change these.</p>}
      {canEdit && (
        <Card>
          <form onSubmit={adjust} className="flex flex-col gap-3">
            <p className="font-extrabold">Adjust a patient’s coins</p>
            <p className="text-sm text-sub">For goodwill or corrections. Use a minus number to remove. Saved to the audit log.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input required placeholder="Mobile number" value={adj.phone} onChange={e => setAdj({ ...adj, phone: e.target.value })} className={input} />
              <input required type="number" placeholder="Coins (e.g. 500 or -200)" value={adj.delta} onChange={e => setAdj({ ...adj, delta: e.target.value })} className={input} />
              <input required minLength={3} placeholder="Reason" value={adj.note} onChange={e => setAdj({ ...adj, note: e.target.value })} className={input} />
            </div>
            <div className="flex gap-3 items-center"><Btn tone="dark">Apply</Btn>{adjMsg && <span className="text-sm font-semibold">{adjMsg}</span>}</div>
          </form>
        </Card>
      )}
    </div>
  );
}

