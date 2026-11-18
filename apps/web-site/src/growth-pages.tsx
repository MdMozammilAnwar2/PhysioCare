import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, growth, isSignedIn, rupees, type CoinWallet, type PartnerMe, type Referral } from './api';
import { Button, Card, ErrorText, Field, Page } from './ui';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
const REASON: Record<string, string> = { welcome: 'Welcome bonus', referral: 'Friend’s first visit', redeem: 'Used on a booking', redeem_return: 'Booking cancelled, coins back', refund_return: 'Refund, coins back', adjust: 'From PhysioCare' };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });

// Patient: coin balance and history, own referral link.
export function Rewards() {
  const [w, setW] = useState<CoinWallet | null>(null);
  const [r, setR] = useState<Referral | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { Promise.all([growth.coins(), growth.referral()]).then(([a, b]) => { setW(a); setR(b); }).catch(e => setError(msg(e))); }, []);
  async function share() {
    if (!r) return;
    if (navigator.share) { await navigator.share({ title: 'PhysioCare', text: r.shareText }).catch(() => undefined); return; }
    await navigator.clipboard.writeText(r.shareText); setCopied(true);
  }
  return (
    <Page title="Refer & coins" sub="10 coins = ₹1. Use coins on any booking.">
      <ErrorText error={error} />
      {w && (
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-sub font-semibold">Your coins</p>
          <p className="text-4xl font-extrabold">{w.balance.toLocaleString('en-IN')}</p>
          <p className="text-sub">Worth {rupees(w.rupeesPaise)}</p>
        </Card>
      )}
      {r && (
        <Card className="flex flex-col gap-3">
          <p className="text-lg font-extrabold">Invite friends and family</p>
          <p className="text-sub">They get {r.welcomeCoins} coins (₹{r.welcomeCoins / r.coinsPerRupee}) when they join. You get {r.referrerCoins} coins (₹{r.referrerCoins / r.coinsPerRupee}) when their first visit is paid.</p>
          <div className="flex items-center gap-3 rounded-xl bg-canvas px-4 py-3"><span className="text-sm text-sub">Your code</span><span className="font-mono text-xl font-extrabold tracking-wider">{r.code}</span></div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={share}>{copied ? 'Copied ✓' : 'Share invite'}</Button>
            <a className="min-h-12 px-5 rounded-xl bg-[#25D366] text-white font-bold inline-flex items-center" href={`https://wa.me/?text=${encodeURIComponent(r.shareText)}`} target="_blank" rel="noreferrer">WhatsApp</a>
          </div>
          <p className="text-sm text-sub">{r.joined} joined with your link · {r.booked} booked a visit</p>
        </Card>
      )}
      {w && (
        <Card className="flex flex-col gap-2">
          <p className="font-extrabold">History</p>
          {w.entries.length === 0 && <p className="text-sub">No coins yet.</p>}
          {w.entries.map(e => (
            <div key={e.id} className="flex justify-between border-t border-line pt-2 first:border-0 first:pt-0">
              <div><p className="font-semibold">{REASON[e.reason] ?? e.reason}</p><p className="text-xs text-sub">{day(e.created_at)}{e.note && e.reason === 'adjust' ? ` · ${e.note}` : ''}</p></div>
              <span className={`font-extrabold ${e.delta > 0 ? 'text-success-ink' : ''}`}>{e.delta > 0 ? '+' : ''}{e.delta.toLocaleString('en-IN')}</span>
            </div>
          ))}
        </Card>
      )}
    </Page>
  );
}

const TYPES: Record<string, string> = { doctor: 'Doctor', hospital: 'Hospital', clinic: 'Clinic', pathology_lab: 'Pathology lab', physiotherapist: 'Physiotherapist', pharmacy: 'Pharmacy', gym: 'Gym', other: 'Other' };

function QrCard({ l }: { l: NonNullable<PartnerMe['links']>[number] }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let u: string | null = null; api.imageUrl(l.qrUrl).then(x => { u = x; setSrc(x); }).catch(() => undefined); return () => { if (u) URL.revokeObjectURL(u); }; }, [l.qrUrl]);
  const label = l.meta?.label ?? 'QR';
  return (
    <Card className="flex gap-4 items-start">
      {src ? <img src={src} alt={`QR code: ${label}`} className="w-36 h-36 rounded-xl border border-line" /> : <div className="w-36 h-36 rounded-xl bg-canvas" />}
      <div className="flex flex-col gap-1 text-sm min-w-0">
        <p className="font-extrabold text-base">{label}</p>
        <p className="font-mono">{l.code}</p>
        <p className="text-sub">{l.scans} scans · {l.signups} joined · {l.paid} booked</p>
        {src && <a href={src} download={`PhysioCare-${label}.png`} className="text-brand font-bold">Download to print</a>}
        <button onClick={() => navigator.clipboard.writeText(l.url)} className="text-left text-brand font-bold">Copy link</button>
      </div>
    </Card>
  );
}

// Partner portal: apply, then QR codes, results and rewards.
export function PartnerPortal() {
  const [d, setD] = useState<PartnerMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', type: 'doctor', contactName: '', registrationNo: '', address: '', payoutTo: '' });
  const [label, setLabel] = useState('');
  const [payoutTo, setPayoutTo] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { growth.partner().then(x => { setD(x); setPayoutTo(x.partner?.payout_to ?? ''); }).catch(e => setError(msg(e))); }, []);
  useEffect(() => { if (isSignedIn()) load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setError(null); setBusy(true); try { await fn(); load(); } catch (e) { setError(msg(e)); } finally { setBusy(false); } };

  if (!isSignedIn()) return (
    <Page kicker="For doctors, hospitals, labs and clinics" title="Refer patients to PhysioCare" sub="Get your own QR code. Patients scan it to book verified physiotherapy at home, and you earn for every new patient’s first visit.">
      <Card className="flex flex-col gap-3">
        <ul className="list-disc pl-5 text-sub flex flex-col gap-1"><li>Free to join; approved by our team within 2 working days</li><li>Print your QR for the reception, discharge papers or prescriptions</li><li>See scans, sign-ups and bookings live</li><li>Rewards paid to your UPI or bank account</li></ul>
        <Link to="/signin?as=partner&next=/partner" className="min-h-12 rounded-xl bg-brand text-white font-bold inline-flex items-center justify-center">Sign in with your mobile number</Link>
      </Card>
    </Page>
  );
  if (!d) return <Page title="Partner portal"><ErrorText error={error} /></Page>;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  if (!d.partner) return (
    <Page kicker="Partner portal" title="Join as a partner">
      <Card className="flex flex-col gap-4">
        <Field label="Name (shown to patients)" placeholder="Dr Sinha Ortho Clinic" value={f.name} onChange={set('name')} />
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">You are a
          <select value={f.type} onChange={set('type')} className="h-12 rounded-xl border border-line px-4 text-base text-ink">{d.types.map(t => <option key={t} value={t}>{TYPES[t] ?? t}</option>)}</select>
        </label>
        <Field label="Contact person" value={f.contactName} onChange={set('contactName')} />
        <Field label="Registration number (medical council, hospital or lab)" value={f.registrationNo} onChange={set('registrationNo')} />
        <Field label="Address" value={f.address} onChange={set('address')} />
        <Field label="Pay rewards to (UPI ID, or bank account + IFSC)" value={f.payoutTo} onChange={set('payoutTo')} />
        <ErrorText error={error} />
        <Button disabled={busy || f.name.trim().length < 2} onClick={() => act(() => growth.apply(Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()))))}>Send for approval</Button>
      </Card>
    </Page>
  );

  const p = d.partner;
  if (p.status !== 'approved') return (
    <Page kicker="Partner portal" title={p.name}>
      <Card className="flex flex-col gap-2">
        <p className="text-lg font-extrabold">{p.status === 'pending' ? 'We’re reviewing your details' : p.status === 'suspended' ? 'Your account is paused' : 'Your application wasn’t approved'}</p>
        <p className="text-sub">{p.status === 'pending' ? 'This usually takes up to 2 working days. You’ll get your QR code here once approved.' : p.decision_note ?? 'Contact us for details.'}</p>
      </Card>
    </Page>
  );
  return (
    <Page kicker={`Partner · ${TYPES[p.type] ?? p.type}`} title={p.name} sub={`You earn ${rupees(d.rewardPaise ?? 0)} for every new patient’s first paid visit.`}>
      <ErrorText error={error} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[['Scans', d.links!.reduce((a, l) => a + l.scans, 0)], ['Joined', d.links!.reduce((a, l) => a + l.signups, 0)], ['Reward due', rupees(d.earnedPaise ?? 0)], ['Paid to you', rupees(d.paidPaise ?? 0)]].map(([k, v]) => (
          <Card key={k as string} className="!p-4"><p className="text-xs text-sub font-semibold">{k}</p><p className="text-2xl font-extrabold">{v}</p></Card>
        ))}
      </div>
      <h2 className="text-xl font-extrabold">Your QR codes</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{d.links!.map(l => <QrCard key={l.id} l={l} />)}</div>
      <Card className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1"><Field label="New QR for (e.g. OPD reception, Ward 3, Dr Ali)" value={label} onChange={e => setLabel(e.target.value)} /></div>
        <Button disabled={busy || label.trim().length < 2} onClick={() => act(async () => { await growth.addLink(label.trim()); setLabel(''); })}>Create QR</Button>
      </Card>
      <Card className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1"><Field label="Pay my rewards to (UPI ID, or bank account + IFSC)" value={payoutTo} onChange={e => setPayoutTo(e.target.value)} /></div>
        <Button variant="ghost" disabled={busy || payoutTo.trim().length < 5 || p.access !== 'owner'} onClick={() => act(() => growth.updatePartner({ payoutTo: payoutTo.trim() }))}>Save</Button>
      </Card>
      <Card className="flex flex-col gap-2">
        <p className="font-extrabold">Rewards</p>
        {d.rewards!.length === 0 && <p className="text-sub">Rewards appear when a patient you referred has their first visit paid.</p>}
        {d.rewards!.map(r => (
          <div key={r.id} className="flex justify-between border-t border-line pt-2 first:border-0 first:pt-0 text-sm">
            <span>{day(r.created_at)} · {r.label ?? 'QR'}</span>
            <span className="font-bold">{rupees(r.amount_paise)} · {r.status === 'paid' ? `paid (${r.reference})` : 'due'}</span>
          </div>
        ))}
      </Card>
    </Page>
  );
}
