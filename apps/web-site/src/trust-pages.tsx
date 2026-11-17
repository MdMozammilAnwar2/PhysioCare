import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, rupees, trust, type ChatMessage, type PatientRefund, type Plan, type RefundEstimate } from './api';
import { Button, Card, Chips, ErrorText, Field, Page } from './ui';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
const TAGS: [string, string][] = [['on_time', 'On time'], ['explained_clearly', 'Explained clearly'], ['respectful', 'Respectful'], ['felt_better', 'I feel better'], ['too_rushed', 'Too rushed'], ['late', 'Came late']];
const CATEGORIES: [string, string][] = [['no_show', 'Physio didn’t come'], ['behaviour', 'Behaviour'], ['hurt', 'I got hurt'], ['missing_item', 'Something missing or damaged'], ['payment', 'Payment'], ['other', 'Other']];
const textareaCls = 'rounded-xl border border-line p-3 text-base text-ink focus:outline-none focus:ring-2 focus:ring-brand';

// Rate a completed visit.
export function RateVisit() {
  const { id = '' } = useParams();
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit() {
    setError(null);
    try { await trust.rate(id, { stars, tags, comment: comment.trim() || undefined }); setDone(true); } catch (e) { setError(msg(e)); }
  }
  if (done) return <Page title="Thank you"><Card><p>Your rating helps other families choose.</p><Link to="/bookings" className="text-brand font-bold">Back to my bookings ›</Link></Card></Page>;
  return (
    <Page kicker="Your visit" title="How was it?">
      <Card className="flex flex-col gap-4">
        <div className="flex gap-2" role="radiogroup" aria-label="Stars">
          {[1, 2, 3, 4, 5].map(n => <button key={n} role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setStars(n)} className={`text-4xl leading-none min-w-11 min-h-11 ${n <= stars ? 'text-warning' : 'text-line'}`}>★</button>)}
        </div>
        <Chips options={TAGS} value={tags} onChange={t => setTags(x => (x.includes(t) ? x.filter(y => y !== t) : [...x, t]))} />
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">Anything else? (optional)
          <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} rows={3} className={textareaCls} />
        </label>
        <ErrorText error={error} />
        <Button disabled={!stars} onClick={submit}>Send rating</Button>
      </Card>
    </Page>
  );
}

// Report a problem with a visit. Freezes the physio's earning for it until ops decide.
export function ReportProblem() {
  const { id = '' } = useParams();
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function addFile(f: File | undefined) {
    if (!f) return; setError(null); setBusy(true);
    try { const up = await api.upload(f, 'incident'); setFiles(x => [...x, { id: up.id, name: up.name }]); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  async function submit() {
    setError(null); setBusy(true);
    try { await trust.report({ visitId: id, category, description, fileIds: files.map(f => f.id) }); setDone(true); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  if (done) return <Page title="We’ve got it"><Card><p>Our team will look into this and reply to you. If you feel unsafe right now, call 112.</p><Link to="/bookings" className="text-brand font-bold">Back to my bookings ›</Link></Card></Page>;
  return (
    <Page kicker="Your visit" title="Report a problem" sub="Only our team reads this. If you feel unsafe right now, call 112.">
      <Card className="flex flex-col gap-4">
        <Chips options={CATEGORIES} value={category} onChange={setCategory} />
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">What happened?
          <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={3000} rows={5} className={textareaCls} />
        </label>
        <label className="text-sm font-semibold text-sub">Photos or documents (optional, up to 5)
          <input type="file" accept="image/*,application/pdf" disabled={busy || files.length >= 5} onChange={e => addFile(e.target.files?.[0])} className="block mt-1.5" />
        </label>
        {files.map(f => <p key={f.id} className="text-sm">📎 {f.name}</p>)}
        <ErrorText error={error} />
        <Button disabled={busy || !category || description.trim().length < 10} onClick={submit}>Send report</Button>
      </Card>
    </Page>
  );
}

const REFUND_STATUS: Record<string, string> = { requested: 'Refund requested', approved: 'Refund approved, sending soon', paid: 'Refund sent', rejected: 'Refund not approved' };

// Plans with sessions used; refund of unused sessions.
export function Plans() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [refunds, setRefunds] = useState<PatientRefund[]>([]);
  const [est, setEst] = useState<RefundEstimate | null>(null);
  const [refundTo, setRefundTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const load = useCallback(() => { Promise.all([trust.plans(), trust.refunds()]).then(([p, r]) => { setPlans(p.plans); setRefunds(r.refunds); }).catch(e => setError(msg(e))); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = params.get('refund'); setEst(null); if (id) trust.refundEstimate(id).then(setEst).catch(e => setError(msg(e))); }, [params]);
  async function request() {
    if (!est) return; setError(null);
    try { await trust.requestRefund(est.planId, refundTo.trim()); setRefundTo(''); setParams({}); load(); } catch (e) { setError(msg(e)); }
  }
  return (
    <Page title="My plans">
      <ErrorText error={error} />
      {est && (
        <Card className="flex flex-col gap-3 border-brand">
          <p className="text-lg font-extrabold">Refund {est.unused} unused session{est.unused === 1 ? '' : 's'}: {rupees(est.amountPaise)}</p>
          <p className="text-sm text-sub">Future visits in this plan will be cancelled. We send the money within 7 working days of approval.</p>
          <Field label="Send the refund to (your UPI ID, or bank account number + IFSC)" value={refundTo} onChange={e => setRefundTo(e.target.value)} />
          <div className="flex gap-2"><Button disabled={refundTo.trim().length < 5 || est.amountPaise <= 0} onClick={request}>Request refund</Button><Button variant="ghost" onClick={() => setParams({})}>Cancel</Button></div>
        </Card>
      )}
      {plans === null && !error && <p className="text-sub">Loading…</p>}
      {plans?.length === 0 && <Card><p className="font-bold">No plans yet</p><Link to="/book" className="text-brand font-bold">Book your first visit ›</Link></Card>}
      {plans?.map(p => {
        const r = refunds.find(x => x.plan_id === p.id);
        return (
          <Card key={p.id} className="flex flex-col gap-2">
            <div className="flex justify-between flex-wrap gap-2"><p className="text-lg font-extrabold">{p.therapist_name} · {p.sessions_total}-session {p.mode} plan</p><span className="font-bold">{rupees(p.price_paise)}</span></div>
            <div className="h-2 rounded-full bg-canvas overflow-hidden" role="progressbar" aria-valuenow={p.completed} aria-valuemax={p.sessions_total}><div className="h-full bg-brand" style={{ width: `${(100 * p.completed) / p.sessions_total}%` }} /></div>
            <p className="text-sm text-sub capitalize">{p.completed} of {p.sessions_total} done · {p.status}{p.valid_until ? ` · valid until ${new Date(p.valid_until).toLocaleDateString('en-IN')}` : ''}</p>
            {r && <p className="text-sm font-semibold">{REFUND_STATUS[r.status] ?? r.status} · {rupees(r.amount_paise)}{r.note ? ` · ${r.note}` : ''}</p>}
            <div className="flex gap-4 text-sm font-bold flex-wrap">
              <Link to={`/chat/${p.id}`} className="text-brand">Message physio ›</Link>
              {p.status === 'active' && p.payment_status === 'paid' && p.completed < p.sessions_total && (!r || r.status === 'rejected') && <Link to={`/plans?refund=${p.id}`} className="text-sub underline">Refund unused sessions</Link>}
            </div>
          </Card>
        );
      })}
    </Page>
  );
}

// Chat with the physio for one plan; polls every 5 s. The server blocks contact details.
export function Chat() {
  const { planId = '' } = useParams();
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => trust.messages(planId, last.current).then(r => {
      if (!alive || !r.messages.length) return;
      last.current = r.messages[r.messages.length - 1].id;
      setItems(x => [...x.filter(m => !r.messages.some(n => n.id === m.id)), ...r.messages]);
    }).catch(e => alive && setError(msg(e)));
    poll(); const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [planId]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [items.length]);
  async function send(e: React.FormEvent) {
    e.preventDefault(); const body = text.trim(); if (!body) return; setError(null);
    try {
      const r = await trust.send(planId, body);
      setItems(x => [...x, { id: r.id, body, created_at: new Date().toISOString(), mine: true }]);
      last.current = Math.max(last.current, r.id); setText('');
    } catch (err) { setError(msg(err)); }
  }
  return (
    <Page kicker="Your plan" title="Messages" sub="For your safety, phone numbers and payments outside the app can’t be shared here.">
      <Card className="flex flex-col gap-2 min-h-[320px] max-h-[60vh] overflow-y-auto">
        {items.length === 0 && <p className="text-sub">No messages yet. Say hello.</p>}
        {items.map(m => (
          <div key={m.id} className={`max-w-[80%] rounded-2xl px-4 py-2 ${m.mine ? 'self-end bg-brand text-white' : 'self-start bg-canvas'}`}>
            <p>{m.body}</p><p className={`text-xs ${m.mine ? 'text-white/70' : 'text-sub'}`}>{new Date(m.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}</p>
          </div>
        ))}
        <div ref={end} />
      </Card>
      <ErrorText error={error} />
      <form onSubmit={send} className="flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)} maxLength={1000} placeholder="Type a message" aria-label="Message" className="flex-1 min-w-0 h-12 rounded-xl border border-line px-4" />
        <Button>Send</Button>
      </form>
    </Page>
  );
}
