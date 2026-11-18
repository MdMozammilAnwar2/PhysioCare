import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, grievance, isSignedIn, type MyGrievance, type Officer } from './api';
import { Button, Card, Chips, ErrorText, Page } from './ui';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
const CAT: [string, string][] = [['service', 'Service'], ['physio_conduct', 'Physio’s behaviour'], ['safety', 'Safety'], ['harassment', 'Harassment'], ['payment', 'Payment'], ['refund', 'Refund'], ['privacy', 'Privacy / my data'], ['app', 'App or website'], ['other', 'Other']];
const STATUS: Record<string, string> = { open: 'Received', acknowledged: 'Acknowledged', in_review: 'Being looked into', resolved: 'Resolved', rejected: 'Closed' };
const day = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function OfficerCard({ o }: { o: Officer }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-sm text-sub font-semibold">{o.designation}</p>
      <p className="text-xl font-extrabold">{o.name}</p>
      {o.email && <a href={`mailto:${o.email}`} className="text-brand font-bold">{o.email}</a>}
      {o.phone && <a href={`tel:${o.phone}`} className="text-brand font-bold">{o.phone}</a>}
      <p className="text-sub">{o.address}</p>
      <p className="text-sub">{o.hours}</p>
      <p className="text-sm mt-2">We acknowledge every complaint within <b>{o.ackHours} hours</b> and resolve it within <b>{o.resolveDays} days</b>.</p>
    </Card>
  );
}

// Public page: who the grievance officer is; signed-in users can file and follow complaints.
export function GrievancePage() {
  const [o, setO] = useState<Officer | null>(null);
  const [mine, setMine] = useState<MyGrievance[] | null>(null);
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = isSignedIn();
  const load = useCallback(() => { if (signedIn) grievance.mine().then(r => setMine(r.grievances)).catch(() => undefined); }, [signedIn]);
  useEffect(() => { grievance.officer().then(r => setO(r.officer)).catch(e => setError(msg(e))); load(); }, [load]);
  async function addFile(f?: File) {
    if (!f) return; setBusy(true); setError(null);
    try { const up = await api.upload(f, 'grievance'); setFiles(x => [...x, { id: up.id, name: up.name }]); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError(null);
    try { const r = await grievance.file({ category, description: text.trim(), fileIds: files.map(f => f.id) }); setDone(r.grievance.ticket_no); setText(''); setCategory(''); setFiles([]); load(); }
    catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  return (
    <Page kicker="Grievance redressal" title="Complaints and the Grievance Officer" sub="If something went wrong with a visit, a payment, your data or our service, tell us here. For emergencies call 112.">
      {o && <OfficerCard o={o} />}
      {!signedIn ? (
        <Card className="flex flex-col gap-2">
          <p className="font-bold">File a complaint</p>
          <p className="text-sub">Sign in with your mobile number so we can reply and you can follow it.{o?.email ? <> You can also write to <a className="text-brand font-bold" href={`mailto:${o.email}`}>{o.email}</a>.</> : null}</p>
          <Link to="/signin?next=/grievance" className="min-h-12 rounded-xl bg-brand text-white font-bold inline-flex items-center justify-center">Sign in to file a complaint</Link>
        </Card>
      ) : (
        <Card className="flex flex-col gap-4">
          <p className="font-bold">File a complaint</p>
          {done && <p className="rounded-xl bg-success/10 px-4 py-3 font-semibold">Received. Your ticket number is <b>{done}</b>.</p>}
          <Chips options={CAT} value={category} onChange={setCategory} />
          {(category === 'harassment' || category === 'safety') && <p className="text-sm rounded-xl bg-warning/15 px-4 py-3">This goes only to our grievance committee, in confidence. If you are in danger now, call 112.</p>}
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">What happened? (at least 20 characters)
            <textarea value={text} onChange={e => setText(e.target.value)} rows={5} maxLength={5000} className="rounded-xl border border-line p-3 text-base text-ink" />
          </label>
          <label className="text-sm font-semibold text-sub">Attachments (optional, up to 5)
            <input type="file" accept="image/*,application/pdf" disabled={busy || files.length >= 5} onChange={e => addFile(e.target.files?.[0])} className="block mt-1.5" />
          </label>
          {files.map(f => <p key={f.id} className="text-sm">📎 {f.name}</p>)}
          <ErrorText error={error} />
          <Button disabled={busy || !category || text.trim().length < 20} onClick={submit}>Send complaint</Button>
        </Card>
      )}
      {mine && mine.length > 0 && (
        <Card className="flex flex-col gap-2">
          <p className="font-bold">Your complaints</p>
          {mine.map(g => (
            <Link key={g.id} to={`/grievance/${g.id}`} className="flex justify-between gap-3 border-t border-line pt-2 first:border-0 first:pt-0">
              <span><b className="font-mono">{g.ticket_no}</b> · {CAT.find(c => c[0] === g.category)?.[1] ?? g.category}<span className="block text-xs text-sub">{day(g.created_at)}</span></span>
              <span className="font-semibold text-brand">{STATUS[g.status] ?? g.status} ›</span>
            </Link>
          ))}
        </Card>
      )}
    </Page>
  );
}

export function GrievanceThread() {
  const { id = '' } = useParams();
  const [d, setD] = useState<Awaited<ReturnType<typeof grievance.get>> | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { grievance.get(id).then(setD).catch(e => setError(msg(e))); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Page title="Complaint"><ErrorText error={error} /></Page>;
  const g = d.grievance;
  const open = !['resolved', 'rejected'].includes(g.status);
  return (
    <Page kicker={g.ticket_no} title={STATUS[g.status] ?? g.status} sub={open ? `We’ll resolve this by ${day(g.resolve_due_at)}.` : undefined}>
      {g.resolution && <Card><p className="font-bold">Outcome</p><p>{g.resolution}</p></Card>}
      <div className="flex flex-col gap-2">
        {d.events.map((e, i) => (
          <Card key={i} className="!py-3">
            <p className="text-xs text-sub font-semibold">{day(e.created_at)} · {{ created: 'You wrote', reply: 'Message', acknowledged: 'Acknowledged', resolved: 'Resolved', rejected: 'Closed' }[e.kind] ?? e.kind}</p>
            {e.body && <p className="whitespace-pre-wrap">{e.body}</p>}
          </Card>
        ))}
      </div>
      {open && (
        <Card className="flex flex-col gap-3">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Add more details" className="rounded-xl border border-line p-3" />
          <ErrorText error={error} />
          <Button disabled={text.trim().length < 2} onClick={async () => { try { await grievance.reply(id, text.trim()); setText(''); load(); } catch (e) { setError(msg(e)); } }}>Send</Button>
        </Card>
      )}
      <Link to="/grievance" className="text-brand font-bold">‹ All complaints</Link>
    </Page>
  );
}
