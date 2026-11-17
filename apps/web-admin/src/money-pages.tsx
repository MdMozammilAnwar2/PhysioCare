import { useCallback, useEffect, useState } from 'react';
import { ApiError, money, rupees, when, type Incident, type MoneyRules, type Payout, type Refund } from './api';
import { Header } from './pages';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <section className={`rounded-card bg-white border border-line p-5 ${className}`}>{children}</section>;
const Btn = ({ tone = 'dark', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'dark' | 'brand' | 'ghost' | 'danger' }) => (
  <button {...p} className={`h-10 px-4 rounded-xl font-bold text-sm disabled:opacity-50 ${{ dark: 'bg-navy text-white', brand: 'bg-brand text-white', ghost: 'bg-white border border-line', danger: 'bg-white border border-danger/40 text-danger-ink' }[tone]} ${p.className ?? ''}`} />
);
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="text-sm font-semibold text-danger-ink">{e}</p> : null);
function Tabs({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return <div className="flex gap-2 flex-wrap">{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={`h-10 px-4 rounded-full text-sm font-bold ${value === v ? 'bg-navy text-white' : 'bg-white border border-line'}`}>{l}</button>)}</div>;
}
const rupeesInput = (s: string) => Math.round(Number(s.replace(/[^\d.]/g, '')) * 100) || 0;
const CATEGORY: Record<string, string> = { missing_item: 'Missing or damaged item', behaviour: 'Behaviour', no_show: 'Physio didn’t come', hurt: 'Hurt during session', payment: 'Payment problem', other: 'Other' };

export function Incidents() {
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<Incident[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setRows(null); money.incidents(status).then(r => setRows(r.incidents)).catch(e => setErr(msg(e))); }, [status]);
  useEffect(() => { load(); }, [load]);
  async function decide(i: Incident, uphold: boolean) {
    const note = window.prompt(uphold ? 'What did you find? (sent to both sides)' : 'Why is it dismissed? (sent to both sides)') ?? '';
    if (note.trim().length < 3) return;
    const refund = uphold ? window.prompt('Refund to the patient in ₹ (0 for none)', '0') ?? '0' : '0';
    try { await money.decideIncident(i.id, { uphold, note, refundPaise: rupeesInput(refund) }); load(); } catch (e) { setErr(msg(e)); }
  }
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Trust & safety" title="Incidents" right={<Tabs value={status} onChange={setStatus} options={[['open', 'Open'], ['upheld', 'Upheld'], ['dismissed', 'Dismissed']]} />} />
      <p className="text-sm text-sub">Reporting freezes the physio’s earning for that visit until you decide. Critical reports first.</p>
      <Err e={err} />
      {rows === null && <p className="text-sub">Loading…</p>}
      {rows?.length === 0 && <Card><p className="text-sub">Nothing here.</p></Card>}
      {rows?.map(i => (
        <Card key={i.id} className={`flex flex-col gap-2 ${i.severity === 'critical' ? 'border-danger/50' : ''}`}>
          <div className="flex justify-between gap-3 flex-wrap">
            <p className="text-lg font-extrabold">{CATEGORY[i.category] ?? i.category} <span className={`ml-2 text-xs font-bold rounded-full px-2 py-1 ${i.severity === 'critical' ? 'bg-danger/15 text-danger-ink' : 'bg-warning/20 text-warning-ink'}`}>{i.severity}</span></p>
            <span className="text-sm text-sub">reported {when(i.created_at)} · visit {when(i.visit_at)}</span>
          </div>
          <p className="text-sm"><b>{i.patient_name ?? 'Patient'}</b> about <b>{i.therapist_name ?? 'physio'}</b></p>
          <p className="text-[15px]">“{i.description}”</p>
          {i.file_ids.length > 0 && <p className="text-sm text-sub">{i.file_ids.length} attachment(s)</p>}
          {i.decision_note && <p className="text-sm text-sub">Decision: {i.decision_note}</p>}
          {i.status === 'open' && <div className="flex gap-2"><Btn tone="danger" onClick={() => decide(i, true)}>Uphold</Btn><Btn tone="ghost" onClick={() => decide(i, false)}>Dismiss &amp; unfreeze</Btn></div>}
        </Card>
      ))}
    </div>
  );
}

export function Refunds({ canPay }: { canPay: boolean }) {
  const [status, setStatus] = useState('requested');
  const [rows, setRows] = useState<Refund[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setRows(null); money.refunds(status).then(r => setRows(r.refunds)).catch(e => setErr(msg(e))); }, [status]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); load(); } catch (e) { setErr(msg(e)); } };
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Money" title="Refunds" right={<Tabs value={status} onChange={setStatus} options={[['requested', 'Requested'], ['approved', 'To pay'], ['paid', 'Paid'], ['rejected', 'Rejected']]} />} />
      <Err e={err} />
      {rows === null && <p className="text-sub">Loading…</p>}
      {rows?.length === 0 && <Card><p className="text-sub">Nothing here.</p></Card>}
      {rows?.map(r => (
        <Card key={r.id} className="flex justify-between gap-4 flex-wrap items-center">
          <div>
            <p className="text-lg font-extrabold">{rupees(r.amount_paise)} · {r.reason === 'unused_sessions' ? 'Unused sessions' : 'Incident'}</p>
            <p className="text-sm text-sub">{r.patient_name ?? 'Patient'} · {r.patient_phone} · requested {when(r.created_at)}</p>
            {r.refund_to && <p className="text-sm">Send to: <b>{r.refund_to}</b></p>}
            {r.reference && <p className="text-sm text-sub">Ref {r.reference}</p>}
          </div>
          <div className="flex gap-2">
            {r.status === 'requested' && <><Btn tone="brand" onClick={() => act(() => money.decideRefund(r.id, true))}>Approve</Btn><Btn tone="danger" onClick={() => { const n = window.prompt('Reason (sent to the patient)'); if (n?.trim()) act(() => money.decideRefund(r.id, false, n)); }}>Reject</Btn></>}
            {r.status === 'approved' && canPay && <Btn tone="dark" onClick={() => { const ref = window.prompt('Transfer reference (UTR) after sending the money'); if (ref?.trim()) act(() => money.refundPaid(r.id, ref.trim())); }}>Mark paid</Btn>}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function Payouts() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<Payout[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const load = useCallback(() => { setRows(null); money.payouts(status).then(r => setRows(r.payouts)).catch(e => setErr(msg(e))); }, [status]);
  useEffect(() => { load(); }, [load]);
  async function build() { setErr(null); try { const r = await money.buildBatch(); setInfo(`Batch created for ${r.payees} physio(s).`); setStatus('pending'); load(); } catch (e) { setErr(msg(e)); } }
  async function paid(p: Payout) {
    const method = window.prompt('Paid by "bank" or "upi"?', 'upi')?.trim().toLowerCase();
    if (method !== 'bank' && method !== 'upi') return;
    const ref = window.prompt('Transfer reference (UTR)')?.trim();
    if (!ref) return;
    try { await money.payoutPaid(p.id, method, ref); load(); } catch (e) { setErr(msg(e)); }
  }
  const total = rows?.reduce((a, p) => a + p.amount_paise, 0) ?? 0;
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Money" title="Payouts" right={<div className="flex gap-2 items-center"><Tabs value={status} onChange={setStatus} options={[['pending', 'To pay'], ['paid', 'Paid']]} /><Btn tone="brand" onClick={build}>Build this week’s batch</Btn></div>} />
      <p className="text-sm text-sub">Send each amount by bank transfer or UPI, then record the reference. Earnings frozen by a report are left out automatically.</p>
      {info && <p className="text-sm font-semibold text-success-ink">{info}</p>}
      <Err e={err} />
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-sub text-left"><tr>{['Physio', 'Sessions', 'TDS', 'Net to pay', status === 'paid' ? 'Paid' : ''].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={5} className="px-4 py-6 text-sub">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-sub">Nothing here.</td></tr>}
            {rows?.map(p => (
              <tr key={p.id} className="border-t border-line">
                <td className="px-4 py-3"><div className="font-bold">{p.therapist_name}</div><div className="text-sub">{p.therapist_phone}</div></td>
                <td className="px-4 py-3">{p.sessions}</td>
                <td className="px-4 py-3">{rupees(p.tds_paise)}</td>
                <td className="px-4 py-3 font-extrabold">{rupees(p.amount_paise)}</td>
                <td className="px-4 py-3 text-right">{p.status === 'paid' ? <span className="text-sub">{p.method?.toUpperCase()} · {p.reference} · {when(p.paid_at)}</span> : <Btn tone="dark" onClick={() => paid(p)}>Mark paid</Btn>}</td>
              </tr>
            ))}
          </tbody>
          {rows && rows.length > 0 && <tfoot><tr className="border-t border-line bg-canvas"><td className="px-4 py-3 font-bold" colSpan={3}>Total</td><td className="px-4 py-3 font-extrabold">{rupees(total)}</td><td /></tr></tfoot>}
        </table>
      </Card>
    </div>
  );
}

export function Tds() {
  const fy = new Date().getUTCMonth() >= 3 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
  const [from, setFrom] = useState(`${fy}-04-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Awaited<ReturnType<typeof money.tds>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { money.tds(from, to).then(setData).catch(e => setErr(msg(e))); }, [from, to]);
  function csv() {
    if (!data) return;
    const lines = [['Physio', 'Phone', 'Sessions', 'Gross', 'Platform fee', 'TDS', 'Net'], ...data.rows.map(r => [r.name ?? '', r.phone, r.sessions, r.gross_paise / 100, r.fee_paise / 100, r.tds_paise / 100, r.net_paise / 100])];
    const blob = new Blob([lines.map(l => l.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tds_${from}_${to}.csv`; a.click();
  }
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Money" title="TDS report" right={<div className="flex gap-2 items-center">
        <label className="text-sm text-sub">From <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-10 rounded-xl border border-line px-2" /></label>
        <label className="text-sm text-sub">To <input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-10 rounded-xl border border-line px-2" /></label>
        <Btn tone="ghost" onClick={csv}>Download CSV</Btn></div>} />
      <Err e={err} />
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-sub text-left"><tr>{['Physio', 'Sessions', 'Gross', 'Platform fee', 'TDS', 'Net'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {data?.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-sub">No earnings in this period.</td></tr>}
            {data?.rows.map(r => <tr key={r.id} className="border-t border-line"><td className="px-4 py-3 font-bold">{r.name}</td><td className="px-4 py-3">{r.sessions}</td><td className="px-4 py-3">{rupees(r.gross_paise)}</td><td className="px-4 py-3">{rupees(r.fee_paise)}</td><td className="px-4 py-3 font-bold">{rupees(r.tds_paise)}</td><td className="px-4 py-3">{rupees(r.net_paise)}</td></tr>)}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function MoneyRulesPage({ canEdit }: { canEdit: boolean }) {
  const [r, setR] = useState<MoneyRules | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { money.rules().then(x => setR(x.rules)).catch(e => setErr(msg(e))); }, []);
  if (!r) return <div><Header title="Fees, TDS & holds" /><Err e={err} /></div>;
  const field = (k: keyof MoneyRules, label: string, hint: string, scale = 1) => (
    <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">{label}
      <input disabled={!canEdit} type="number" value={r[k] / scale} onChange={e => { setSaved(false); setR({ ...r, [k]: Math.round(Number(e.target.value) * scale) }); }} className="h-11 rounded-xl border border-line px-3 text-ink text-base disabled:bg-canvas" />
      <span className="font-normal text-xs">{hint}</span>
    </label>
  );
  async function save() { setErr(null); try { await money.saveRules(r!); setSaved(true); } catch (e) { setErr(msg(e)); } }
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <Header kicker="Money" title="Fees, TDS & holds" />
      {r.platformFeePct === 0 && <p className="rounded-xl bg-warning/20 text-warning-ink font-semibold text-sm px-4 py-3">Platform fee is 0%. Set it before paid bookings go live.</p>}
      <Card className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field('platformFeePct', 'Platform fee (%)', 'Taken from each session price.')}
        {field('tdsPct', 'TDS (%)', 'On the amount paid to the physio. Confirm the section and rate with your CA.')}
        {field('holdDays', 'Hold (days)', 'Earnings wait this long before payout (patient protection).')}
        {field('minPayoutPaise', 'Minimum payout (₹)', 'Below this, earnings roll into the next batch.', 100)}
        {field('reportWindowDays', 'Report window (days)', 'How long after a visit a patient can report a problem.')}
      </Card>
      <Err e={err} />
      {canEdit ? <div className="flex gap-3 items-center"><Btn tone="brand" onClick={save}>Save</Btn>{saved && <span className="text-sm text-success-ink font-semibold">Saved. New earnings use these rates.</span>}</div> : <p className="text-sm text-sub">Only a super admin can change these.</p>}
    </div>
  );
}
