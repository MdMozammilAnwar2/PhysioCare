import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, DOC_LABEL, rupees, when, type Doc, type LiveVisit, type PaymentRow, type QueueRow, type Sos } from './api';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const pill = (text: string, tone: 'green' | 'amber' | 'red' | 'blue' | 'grey') => {
  const c = { green: 'bg-success/15 text-success-ink', amber: 'bg-warning/20 text-warning-ink', red: 'bg-danger/15 text-danger-ink', blue: 'bg-brand-soft text-brand', grey: 'bg-canvas text-sub' }[tone];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${c}`}>{text}</span>;
};
export const Header = ({ kicker, title, right }: { kicker?: string; title: string; right?: React.ReactNode }) => (
  <div className="flex justify-between items-end gap-4 flex-wrap">
    <div>{kicker && <p className="text-sm text-sub font-semibold">{kicker}</p>}<h1 className="text-3xl font-extrabold tracking-tight">{title}</h1></div>
    {right}
  </div>
);
const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <section className={`rounded-card bg-white border border-line p-5 ${className}`}>{children}</section>;
const Btn = ({ tone = 'dark', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'dark' | 'brand' | 'ghost' | 'danger' }) => (
  <button {...p} className={`h-10 px-4 rounded-xl font-bold text-sm disabled:opacity-50 ${{ dark: 'bg-navy text-white', brand: 'bg-brand text-white', ghost: 'bg-white border border-line', danger: 'bg-white border border-danger/40 text-danger-ink' }[tone]} ${p.className ?? ''}`} />
);
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="text-sm font-semibold text-danger-ink">{e}</p> : null);

// ---------- File viewer (images inline, PDFs in a frame) ----------
function FileView({ fileId, mime, alt }: { fileId: string; mime: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    api.fileUrl(fileId).then(x => { u = x; setUrl(x); }).catch(e => setErr(msg(e)));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [fileId]);
  if (err) return <Err e={err} />;
  if (!url) return <div className="h-64 rounded-xl bg-canvas animate-pulse" />;
  if (mime === 'application/pdf') return <iframe title={alt} src={url} className="w-full h-96 rounded-xl border border-line" />;
  if (mime.startsWith('video/')) return <video src={url} controls className="w-full max-h-96 rounded-xl" />;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={alt} className="max-h-96 rounded-xl border border-line object-contain bg-canvas" /></a>;
}

// ---------- Verification queue ----------
export function VerificationQueue() {
  const [status, setStatus] = useState('under_review');
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [required, setRequired] = useState(6);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setRows(null); api.verificationQueue(status).then(r => { setRows(r.therapists); setRequired(r.requiredDocuments); }).catch(e => setErr(msg(e))); }, [status]);
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="People" title="Verification" right={
        <div className="flex gap-2">{[['under_review', 'Waiting'], ['applied', 'Returned / not submitted'], ['verified', 'Verified']].map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={`h-10 px-4 rounded-full text-sm font-bold ${status === v ? 'bg-navy text-white' : 'bg-white border border-line'}`}>{l}</button>
        ))}</div>
      } />
      <Err e={err} />
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-sub text-left"><tr>{['Physio', 'Qualification', 'Specialisations', 'Submitted', 'Documents', ''].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className="px-4 py-6 text-sub">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-sub">Nobody here right now.</td></tr>}
            {rows?.map(r => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-4 py-3"><div className="font-bold">{r.name ?? '—'}</div><div className="text-sub">{r.phone} · {r.gender ?? '—'}</div></td>
                <td className="px-4 py-3">{r.qualification ?? '—'} · {r.years_experience ?? 0} yrs</td>
                <td className="px-4 py-3">{r.specialisations?.join(', ')}</td>
                <td className="px-4 py-3">{when(r.submitted_at)}</td>
                <td className="px-4 py-3">{pill(`${r.docs_approved} / ${required} approved`, r.docs_approved === required ? 'green' : 'amber')}</td>
                <td className="px-4 py-3 text-right"><Link to={`/verification/${r.id}`} className="font-bold text-brand">Review ›</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Therapist review ----------
export function TherapistReview() {
  const { id = '' } = useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.therapist>> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.therapist(id).then(setData).catch(e => setErr(msg(e))), [id]);
  useEffect(() => { load(); }, [load]);

  async function doc(d: Doc, approve: boolean) {
    const reason = approve ? undefined : window.prompt(`Why is “${DOC_LABEL[d.type]}” rejected? The physio will see this.`) ?? '';
    if (!approve && !reason?.trim()) return;
    setErr(null);
    try { await api.reviewDocument(d.id, approve, reason); await load(); } catch (e) { setErr(msg(e)); }
  }
  async function decide(approve: boolean) {
    if (!approve && !note.trim()) return setErr('Write what the physio needs to change.');
    setErr(null); setBusy(true);
    try { await api.verifyTherapist(id, approve, note.trim() || undefined); setNote(''); await load(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  }
  if (!data) return <div className="flex flex-col gap-4"><Link to="/verification" className="text-brand font-bold">‹ Verification</Link><Err e={err} />{!err && <p className="text-sub">Loading…</p>}</div>;
  const t = data.therapist;
  const byType = Object.fromEntries(data.documents.map(d => [d.type, d]));
  const allApproved = data.requiredDocuments.every(x => byType[x]?.status === 'approved');
  return (
    <div className="flex flex-col gap-5">
      <Link to="/verification" className="text-brand font-bold text-sm">‹ Verification</Link>
      <Header kicker={`${t.phone} · ${t.gender ?? '—'}`} title={t.name ?? 'Unnamed physio'} right={pill(t.verification_status.replace('_', ' '), t.verification_status === 'verified' ? 'green' : t.verification_status === 'under_review' ? 'amber' : 'grey')} />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="flex flex-col gap-2 text-sm">
          <h2 className="text-lg font-extrabold">Profile</h2>
          <p><b>Qualification:</b> {t.qualification} · {t.years_experience} yrs</p>
          <p><b>Treats:</b> {t.specialisations?.join(', ')}</p>
          <p><b>Languages:</b> {t.languages?.join(', ')}</p>
          <p><b>Service radius:</b> {t.service_radius_km} km</p>
          {t.bio && <p className="text-sub">{t.bio}</p>}
          <h2 className="text-lg font-extrabold mt-3">Agreement</h2>
          {data.agreement ? <p>Signed v{data.agreement.version} by “{data.agreement.meta?.signedName}” on {when(data.agreement.created_at)}</p> : <p className="text-danger-ink font-semibold">Not signed</p>}
        </Card>
        <Card className="xl:col-span-2 flex flex-col gap-3">
          <h2 className="text-lg font-extrabold">Documents</h2>
          {data.requiredDocuments.map(type => {
            const d = byType[type];
            return (
              <div key={type} className="border border-line rounded-xl p-4 flex flex-col gap-3">
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <div><p className="font-bold">{DOC_LABEL[type]}</p>{d && <p className="text-xs text-sub">{d.original_name} · uploaded {when(d.created_at)}{d.review_note ? ` · note: ${d.review_note}` : ''}</p>}</div>
                  <div className="flex gap-2 items-center">
                    {!d ? pill('Missing', 'red') : pill(d.status, d.status === 'approved' ? 'green' : d.status === 'rejected' ? 'red' : 'amber')}
                    {d && <Btn tone="ghost" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? 'Hide' : 'View'}</Btn>}
                    {d && d.status === 'pending' && <><Btn tone="brand" onClick={() => doc(d, true)}>Approve</Btn><Btn tone="danger" onClick={() => doc(d, false)}>Reject</Btn></>}
                  </div>
                </div>
                {d && open === d.id && <FileView fileId={d.file_id} mime={d.mime_type} alt={DOC_LABEL[type]} />}
              </div>
            );
          })}
        </Card>
      </div>
      {t.verification_status === 'under_review' && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-extrabold">Decision</h2>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note to the physio (required if you send it back)" className="min-h-24 rounded-xl border border-line p-3" aria-label="Note to the physio" />
          <Err e={err} />
          <div className="flex gap-2 flex-wrap">
            <Btn tone="brand" disabled={busy || !allApproved} onClick={() => decide(true)}>Approve &amp; verify</Btn>
            <Btn tone="danger" disabled={busy} onClick={() => decide(false)}>Send back for changes</Btn>
            {!allApproved && <span className="text-sm text-sub self-center">Approve every document to verify.</span>}
          </div>
          <p className="text-xs text-sub">Your name and the time are saved to the audit log.</p>
        </Card>
      )}
    </div>
  );
}

// ---------- Payments review ----------
export function Payments() {
  const [status, setStatus] = useState('submitted');
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setRows(null); api.payments(status).then(r => setRows(r.payments)).catch(e => setErr(msg(e))); }, [status]);
  useEffect(() => { load(); }, [load]);
  async function review(p: PaymentRow, approve: boolean) {
    const note = approve ? undefined : window.prompt('Why can’t this payment be confirmed? The patient will see this.') ?? '';
    if (!approve && !note?.trim()) return;
    setErr(null);
    try { await api.reviewPayment(p.id, approve, note); load(); } catch (e) { setErr(msg(e)); }
  }
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Money" title="Payments to confirm" right={
        <div className="flex gap-2">{[['submitted', 'To confirm'], ['pending', 'Not paid yet'], ['paid', 'Confirmed'], ['rejected', 'Rejected']].map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={`h-10 px-4 rounded-full text-sm font-bold ${status === v ? 'bg-navy text-white' : 'bg-white border border-line'}`}>{l}</button>
        ))}</div>
      } />
      <p className="text-sm text-sub">UPI: match the amount and UTR in the bank statement before approving. Cash: confirm the physio has deposited it.</p>
      <Err e={err} />
      {rows === null && <p className="text-sub">Loading…</p>}
      {rows?.length === 0 && <Card><p className="text-sub">Nothing here.</p></Card>}
      {rows?.map(p => (
        <Card key={p.id} className="flex flex-col gap-3">
          <div className="flex justify-between gap-4 flex-wrap items-center">
            <div>
              <p className="text-lg font-extrabold">{rupees(p.amount_paise)} · {p.method === 'upi' ? 'UPI' : 'Cash'} · {p.reference}</p>
              <p className="text-sm text-sub">{p.patient_name ?? 'Patient'} → {p.therapist_name} · submitted {when(p.submitted_at)}{p.utr ? ` · UTR ${p.utr}` : ''}</p>
            </div>
            <div className="flex gap-2">
              {p.proof_file_id && <Btn tone="ghost" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Hide screenshot' : 'View screenshot'}</Btn>}
              {p.status === 'submitted' && <><Btn tone="brand" onClick={() => review(p, true)}>Approve</Btn><Btn tone="danger" onClick={() => review(p, false)}>Reject</Btn></>}
            </div>
          </div>
          {open === p.id && p.proof_file_id && <FileView fileId={p.proof_file_id} mime="image/png" alt={`Payment screenshot for ${p.reference}`} />}
        </Card>
      ))}
    </div>
  );
}

// ---------- Live visits and SOS ----------
export function Live() {
  const [data, setData] = useState<{ sos: Sos[]; visits: LiveVisit[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.live().then(d => { setData(d); setErr(null); }).catch(e => setErr(msg(e))), []);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  async function ack(s: Sos) { try { await api.ackSos(s.id); load(); } catch (e) { setErr(msg(e)); } }
  async function resolve(s: Sos) {
    const note = window.prompt('What happened and how was it resolved?') ?? '';
    if (note.trim().length < 3) return;
    try { await api.resolveSos(s.id, note); load(); } catch (e) { setErr(msg(e)); }
  }
  const mins = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Operations · refreshes every 15 s" title="Live visits" />
      <Err e={err} />
      {data?.sos.map(s => (
        <section key={s.id} role="alert" className={`rounded-card p-5 flex flex-wrap gap-4 justify-between items-center ${s.status === 'open' ? 'bg-danger text-white' : 'bg-warning/20 text-ink'}`}>
          <div>
            <p className="text-lg font-extrabold">SOS · {s.raised_by_name ?? 'Physio'} · {s.status === 'open' ? `${mins(s.created_at)} min, not acknowledged` : 'acknowledged'}</p>
            <p className="text-sm opacity-90">Call {s.raised_by_phone}{s.lat != null ? ` · location ${s.lat.toFixed(4)}, ${s.lng?.toFixed(4)}` : ''}</p>
          </div>
          <div className="flex gap-2">
            {s.lat != null && <a href={`https://www.google.com/maps?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer" className="h-10 px-4 rounded-xl bg-white text-navy font-bold text-sm flex items-center">Open map</a>}
            {s.status === 'open' && <Btn tone="dark" onClick={() => ack(s)}>Acknowledge &amp; call</Btn>}
            <Btn tone="ghost" onClick={() => resolve(s)}>Resolve</Btn>
          </div>
        </section>
      ))}
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-sub text-left"><tr>{['Physio', 'Zone', 'State', 'Time', 'Last location'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {!data && <tr><td colSpan={5} className="px-4 py-6 text-sub">Loading…</td></tr>}
            {data?.visits.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-sub">No visits in progress.</td></tr>}
            {data?.visits.map(v => (
              <tr key={v.id} className="border-t border-line">
                <td className="px-4 py-3 font-bold">{v.therapist_name}</td>
                <td className="px-4 py-3">{v.zone_name ?? 'Video'}</td>
                <td className="px-4 py-3">{v.overrun ? pill('Overrun', 'amber') : v.status === 'checked_in' ? pill('In session', 'green') : pill('On the way', 'blue')}</td>
                <td className="px-4 py-3">{when(v.starts_at)}</td>
                <td className="px-4 py-3">{v.lat != null ? <a className="text-brand font-bold" href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noreferrer">{when(v.location_at)} ›</a> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
