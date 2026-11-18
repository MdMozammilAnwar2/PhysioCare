import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, calendar, comms, growth, isSignedIn, maps, rupees, type PlacePick, type Booking, type Match, type Package, type Payment, type Zone } from './api';
import { captureAttribution, draft, pendingAttribution } from './booking-state';
import { Button, Card, Chips, ErrorText, Field, Page, ZonePill } from './ui';
import { AddressSearch } from './address-search';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
const IST = 'Asia/Kolkata';
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' });
const istYmd = (d: Date) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);

export function RequireAuth({ children }: { children: React.ReactElement }) {
  const loc = useLocation();
  return isSignedIn() ? children : <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname)}`} replace />;
}

// ---------- Home ----------
// ---------- Sign in (phone → OTP) ----------
export function SignIn() {
  const nav = useNavigate();
  const loc = useLocation();
  const next = new URLSearchParams(loc.search).get('next') || '/book';
  const asPartner = new URLSearchParams(loc.search).get('as') === 'partner';
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [ref, setRef] = useState(pendingAttribution().ref ?? '');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      if (step === 'phone') { const r = await api.sendOtp(phone); setDevCode(r.devCode ?? null); if (r.devCode) setCode(r.devCode); setStep('code'); return; }
      const att = pendingAttribution();
      const r = await api.verifyOtp(phone, code, asPartner ? { role: 'partner_owner' } : { ref: ref.trim() || undefined, utm: att.utm });
      if (asPartner) { nav(next); return; }
      localStorage.removeItem('pc.attribution');
      nav(r.isNew || !r.user.name ? `/about-you?next=${encodeURIComponent(next)}` : next);
    } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  }
  return (
    <Page kicker={asPartner ? 'Partner portal' : undefined} title={step === 'phone' ? 'Sign in or create an account' : 'Enter the code'} sub={step === 'phone' ? 'No password needed. We text you a 6-digit code.' : `Sent to +91 ${phone}.`}>
      <form onSubmit={submit} className="contents">
        <Card>
          {step === 'phone' ? (
            <>
              <Field label="Mobile number" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="98765 43210" required />
              {!asPartner && <Field label="Doctor’s or friend’s referral code (optional)" value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. K7MP-4QXR or ROHIT25" />}
            </>
          ) : (
            <Field label="6-digit code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required />
          )}
          {devCode && step === 'code' && <p className="text-sm rounded-xl bg-mist px-3 py-2">Development mode: no SMS is sent. Your code is <b className="font-mono">{devCode}</b> (filled in for you).</p>}
          <ErrorText error={error} />
          <Button disabled={busy}>{step === 'phone' ? 'Send code' : 'Continue'}</Button>
          <p className="text-xs text-sub">By continuing you agree to the Terms and Privacy Policy.</p>
        </Card>
      </form>
    </Page>
  );
}

// ---------- About you + consent ----------
export function AboutYou() {
  const nav = useNavigate();
  const next = new URLSearchParams(useLocation().search).get('next') || '/book';
  const [f, setF] = useState({ name: '', birthYear: '', gender: 'male', condition: 'after_surgery', procedure: '', surgeryDate: '', preferred: 'any' });
  const [agree, setAgree] = useState({ location: false, terms: false, surgeon: false });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF(s => ({ ...s, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!agree.location || !agree.terms) return setError('Please accept the two required consents to continue.');
    try {
      await api.updateMe({ name: f.name, gender: f.gender, birthYear: f.birthYear ? Number(f.birthYear) : undefined });
      await api.saveProfile({ conditionCategory: f.condition, procedure: f.procedure || undefined, surgeryDate: f.surgeryDate || undefined, preferredGender: f.preferred });
      await api.consents([
        { document: 'location_sharing', version: '1.0', accepted: true },
        { document: 'terms', version: '2.1', accepted: true },
        { document: 'surgeon_sharing', version: '1.0', accepted: agree.surgeon },
      ]);
      nav(next);
    } catch (err) { setError(msg(err)); }
  }
  return (
    <Page kicker="Step 1 of 4" title="About you" sub="This helps us match the right physiotherapist.">
      <form onSubmit={save} className="contents">
        <Card>
          <Field label="Full name" value={f.name} onChange={e => set('name')(e.target.value)} required minLength={2} />
          <Field label="Year of birth" value={f.birthYear} onChange={e => set('birthYear')(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" />
          <span className="text-sm font-semibold text-sub">Gender</span>
          <Chips options={[['female', 'Female'], ['male', 'Male'], ['other', 'Other']]} value={f.gender} onChange={set('gender')} />
        </Card>
        <Card>
          <h2 className="text-xl font-bold">What do you need help with?</h2>
          <Chips options={[['after_surgery', 'After surgery'], ['back_neck', 'Back & neck'], ['sports', 'Sports injury'], ['neuro', 'Stroke & neuro'], ['elderly', 'Elderly care'], ['child', 'Child physio']]} value={f.condition} onChange={set('condition')} />
          <Field label="Procedure (if any)" value={f.procedure} onChange={e => set('procedure')(e.target.value)} placeholder="e.g. ACL reconstruction" />
          <Field label="Surgery date" type="date" value={f.surgeryDate} onChange={e => set('surgeryDate')(e.target.value)} />
          <span className="text-sm font-semibold text-sub">Physiotherapist</span>
          <Chips options={[['female', 'Female'], ['male', 'Male'], ['any', 'No preference']]} value={f.preferred} onChange={set('preferred')} />
        </Card>
        <Card>
          {([['location', 'Share my location and recovery details with my matched physiotherapist (required)'], ['terms', 'I agree to the Terms, Code of Conduct and Privacy Policy (required)'], ['surgeon', 'Share my recovery progress with my surgeon (optional)']] as const).map(([k, t]) => (
            <label key={k} className="flex gap-3 items-start text-[15px]"><input type="checkbox" className="mt-1 w-5 h-5 accent-brand" checked={agree[k]} onChange={e => setAgree(a => ({ ...a, [k]: e.target.checked }))} />{t}</label>
          ))}
          <ErrorText error={error} />
          <Button>Continue</Button>
        </Card>
      </form>
    </Page>
  );
}

// ---------- Where (mode + address → zone) ----------
export function Where() {
  const nav = useNavigate();
  const [mode, setMode] = useState<'home' | 'video'>('home');
  const [zones, setZones] = useState<Zone[]>([]);
  const [area, setArea] = useState('');
  const [line1, setLine1] = useState('');
  const [landmark, setLandmark] = useState('');
  const [result, setResult] = useState<{ id: string; zone: Zone & { outsideService?: boolean } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(false);
  const [picked, setPicked] = useState<PlacePick | null>(null);
  useEffect(() => { api.zones().then(r => setZones(r.zones)).catch(() => undefined); maps.config().then(c => setSearch(c.search)).catch(() => undefined); }, []);

  async function useLocation_() {
    navigator.geolocation?.getCurrentPosition(p => save(p.coords.latitude, p.coords.longitude), () => setError('Couldn’t get your location. Pick your area instead.'));
  }
  async function save(lat?: number, lng?: number) {
    setError(null);
    const z = zones.find(z => z.id === area);
    if (lat === undefined && picked) { lat = picked.lat; lng = picked.lng; }
    if (lat === undefined && !z) return setError(search ? 'Search your address or pick your area.' : 'Pick your area.');
    if (line1.trim().length < 5) return setError('Enter your house and street.');
    try { setResult(await api.addAddress({ line1, landmark: landmark || undefined, lat: lat ?? z!.lat!, lng: lng ?? z!.lng!, placeId: picked?.placeId, formatted: picked?.formatted })); } catch (e) { setError(msg(e)); }
  }
  function next() {
    draft.set({ mode, addressId: mode === 'home' ? result?.id : undefined, zone: result?.zone ? { name: result.zone.name, color: result.zone.color } : undefined });
    nav('/book/physio');
  }
  const blocked = result && (result.zone.color === 'red');
  return (
    <Page kicker="Step 2 of 4" title="Where should the session happen?">
      <Card>
        <Chips options={[['home', 'At home'], ['video', 'Video session']]} value={mode} onChange={setMode} />
        {mode === 'home' && !result && (
          <>
            {search && <AddressSearch onPick={pl => { setPicked(pl); setArea(''); if (!line1) setLine1(pl.formatted.split(',').slice(0, 2).join(',').slice(0, 200)); }} />}
            {picked && <p className="text-sm text-success-ink font-semibold">📍 {picked.formatted}</p>}
            {!picked && <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">{search ? 'Or pick your area' : 'Area in Patna'}
              <select value={area} onChange={e => setArea(e.target.value)} className="h-12 rounded-xl border border-line bg-white px-4 text-base text-ink">
                <option value="">Choose your area</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>}
            <Field label="House, street" value={line1} onChange={e => setLine1(e.target.value)} placeholder="House 12, Road 4" />
            <Field label="Landmark (optional)" value={landmark} onChange={e => setLandmark(e.target.value)} />
            <div className="flex flex-wrap gap-3"><Button onClick={() => save()}>Save address</Button><Button variant="ghost" onClick={useLocation_}>Use my location</Button></div>
          </>
        )}
        {mode === 'home' && result && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3"><span className="font-bold">Your area:</span><ZonePill color={result.zone.color} name={result.zone.name ?? 'Outside our service area'} /></div>
            {result.zone.color === 'orange' && <p className="text-sm text-sub">Home visits here run 8 AM – 6 PM. A male physio visits women only when a family member is home.</p>}
            {blocked && <p className="text-sm text-danger-ink font-semibold">Home visits are paused in this area right now. You can book a video session instead.</p>}
          </div>
        )}
        <ErrorText error={error} />
        <Button disabled={mode === 'home' && (!result || Boolean(blocked))} onClick={next}>Find my physiotherapist</Button>
      </Card>
    </Page>
  );
}

// ---------- Top 3 matches ----------
export function Physio() {
  const nav = useNavigate();
  const d = draft.get();
  const [family, setFamily] = useState(Boolean(d.familyPresent));
  const [data, setData] = useState<{ matches: Match[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    api.match({ mode: d.mode ?? 'home', addressId: d.addressId, familyPresent: family }).then(setData).catch(e => setError(msg(e)));
  }, [family]); // eslint-disable-line react-hooks/exhaustive-deps
  function pick(m: Match) {
    draft.set({ therapistId: m.id, therapistName: m.name, familyPresent: family, requiresFamilyAndConsent: m.requiresFamilyAndConsent });
    nav('/book/time');
  }
  return (
    <Page kicker="Step 3 of 4" title="Your top 3" sub="Verified physiotherapists who treat your problem near you.">
      <label className="flex gap-3 items-center text-[15px]"><input type="checkbox" className="w-5 h-5 accent-brand" checked={family} onChange={e => setFamily(e.target.checked)} />An adult family member will be at home during visits</label>
      <ErrorText error={error} />
      {!data && !error && <p className="text-sub">Finding physios…</p>}
      {data?.matches.length === 0 && <Card><p className="font-bold">No physio is free near you yet.</p><p className="text-sub">Try a video session, or tell us and our team will find one for you.</p></Card>}
      {data?.matches.map((m, i) => (
        <Card key={m.id} className={i === 0 ? 'border-2 border-brand' : ''}>
          <div className="flex justify-between gap-4 flex-wrap">
            <div>
              {i === 0 && <span className="text-xs font-bold text-brand">BEST MATCH</span>}
              <h2 className="text-xl font-extrabold">{m.name}</h2>
              <p className="text-sub text-sm">{m.qualification} · {m.yearsExperience} yrs{m.distanceKm !== null ? ` · ${m.distanceKm} km` : ''}{m.rating ? ` · ★ ${m.rating}` : ''}</p>
              {m.requiresFamilyAndConsent && <p className="text-sm text-warning-ink font-semibold mt-1">Male physio · needs your family member present and his consent</p>}
            </div>
            <div className="text-right"><p className="text-2xl font-extrabold">{rupees(m.pricePaise)}</p><p className="text-xs text-sub">per session</p></div>
          </div>
          <Button variant={i === 0 ? 'primary' : 'ghost'} onClick={() => pick(m)}>Choose {m.name.split(' ').slice(-1)}</Button>
        </Card>
      ))}
    </Page>
  );
}

// ---------- Time + plan + pay ----------
export function Time() {
  const nav = useNavigate();
  const d = draft.get();
  const [days] = useState(() => Array.from({ length: 7 }, (_, i) => istYmd(new Date(Date.now() + i * 864e5))));
  const [day, setDay] = useState(days[0]);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [pkg, setPkg] = useState<string>('single');
  const [fm, setFm] = useState({ name: '', relation: '' });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!d.therapistId) return;
    api.therapist(d.therapistId).then(r => {
      setPackages(r.therapist.packages.filter(p => p.mode === d.mode));
      setPrice(r.therapist.prices.find(p => p.mode === d.mode)?.price_paise ?? null);
    }).catch(e => setError(msg(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!d.therapistId) return;
    setSlots(null); setSlot(null);
    api.slots(d.therapistId, { mode: d.mode ?? 'home', from: day, days: 1, addressId: d.addressId }).then(r => setSlots(r.slots)).catch(e => setError(msg(e)));
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  const amount = useMemo(() => (pkg === 'single' ? price : packages.find(p => p.id === pkg)?.price_paise) ?? 0, [pkg, price, packages]);
  if (!d.therapistId) return <Navigate to="/book" replace />;

  async function pay() {
    if (!slot) return setError('Pick a time.');
    if (d.requiresFamilyAndConsent && (!fm.name || !fm.relation || !consent)) return setError('Add who will be at home and give your consent.');
    setError(null); setBusy(true);
    try {
      const hold = await api.hold({ therapistId: d.therapistId, start: slot, mode: d.mode, addressId: d.addressId, packageId: pkg === 'single' ? undefined : pkg, familyMember: d.requiresFamilyAndConsent ? fm : undefined });
      draft.set({ hold: { visitId: hold.visitId, amountPaise: hold.amountPaise, start: slot, holdExpiresAt: hold.holdExpiresAt } });
      nav('/book/pay');
    } catch (e) { setError(msg(e)); if (e instanceof ApiError && e.code === 'slot_taken') setDay(day); } finally { setBusy(false); }
  }

  return (
    <Page kicker="Step 4 of 4" title={`Book ${d.therapistName}`} sub={d.zone ? undefined : 'Video session'}>
      {d.zone && <ZonePill color={d.zone.color as 'green'} name={d.zone.name} />}
      <Card>
        <h2 className="text-xl font-bold">Pick a day and time</h2>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map(x => <button key={x} onClick={() => setDay(x)} className={`shrink-0 min-h-11 px-4 rounded-xl text-sm font-bold ${x === day ? 'bg-navy text-white' : 'bg-white border border-line'}`}>{fmtDay(`${x}T12:00:00+05:30`)}</button>)}
        </div>
        {!slots && <p className="text-sub">Loading times…</p>}
        {slots?.length === 0 && <p className="text-sub">No free times this day. Try another day.</p>}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {slots?.map(s => <button key={s} onClick={() => setSlot(s)} className={`min-h-11 rounded-xl text-sm font-bold ${s === slot ? 'bg-brand text-white' : 'bg-white border border-line'}`}>{fmtTime(s)}</button>)}
        </div>
      </Card>
      <Card>
        <h2 className="text-xl font-bold">Choose a plan</h2>
        {price !== null && <PlanOption on={pkg === 'single'} onClick={() => setPkg('single')} title="Single session" sub="Pay as you go" price={price} />}
        {packages.map(p => <PlanOption key={p.id} on={pkg === p.id} onClick={() => setPkg(p.id)} title={p.name} sub={`${p.sessions} sessions · valid ${p.validity_days} days`} price={p.price_paise} />)}
      </Card>
      {d.requiresFamilyAndConsent && (
        <Card>
          <h2 className="text-xl font-bold">Who will be at home?</h2>
          <p className="text-sm text-sub">A male physio visits a woman only when an adult family member is present. He will be asked to agree too.</p>
          <Field label="Family member’s name" value={fm.name} onChange={e => setFm(s => ({ ...s, name: e.target.value }))} />
          <Field label="Relationship" value={fm.relation} onChange={e => setFm(s => ({ ...s, relation: e.target.value }))} placeholder="e.g. Husband, Son" />
          <label className="flex gap-3 items-start text-[15px]"><input type="checkbox" className="mt-1 w-5 h-5 accent-brand" checked={consent} onChange={e => setConsent(e.target.checked)} />I consent to a male physiotherapist treating me with my family member present.</label>
        </Card>
      )}
      <Card>
        <div className="flex justify-between text-lg"><span className="font-bold">Total</span><span className="font-extrabold">{rupees(amount)}</span></div>
        <ErrorText error={error} />
        <Button variant="dark" disabled={busy || !slot} onClick={pay}>{busy ? 'Holding your slot…' : 'Continue to payment'}</Button>
        <p className="text-xs text-sub">Pay by UPI (scan our QR) or in cash at the visit. Your slot is held for 10 minutes.</p>
      </Card>
    </Page>
  );
}
const PlanOption = ({ on, onClick, title, sub, price }: { on: boolean; onClick: () => void; title: string; sub: string; price: number }) => (
  <button onClick={onClick} className={`text-left rounded-2xl p-4 flex justify-between items-center ${on ? 'border-2 border-brand bg-brand-soft' : 'border border-line bg-white'}`}>
    <span><span className="block font-bold">{title}</span><span className="block text-sm text-sub">{sub}</span></span>
    <span className="text-xl font-extrabold">{rupees(price)}</span>
  </button>
);

// ---------- Choose how to pay (booking is confirmed here) ----------
export function ChoosePayment() {
  const nav = useNavigate();
  const d = draft.get();
  const [method, setMethod] = useState<'upi' | 'cash'>('upi');
  const [coins, setCoins] = useState<{ coins: number; discountPaise: number; maxPct: number } | null>(null);
  const [useCoins, setUseCoins] = useState(true);
  useEffect(() => { if (d.hold) growth.checkout(d.hold.amountPaise).then(setCoins).catch(() => undefined); }, [d.hold?.amountPaise]); // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!d.hold) return <Navigate to="/bookings" replace />;
  const h = d.hold;
  async function confirm() {
    setError(null); setBusy(true);
    try {
      const r = await api.confirm(h.visitId, method, useCoins && Boolean(coins?.coins));
      draft.clear();
      nav(`/payments/${r.payment.id}?new=1`);
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  const off = useCoins && coins?.coins ? coins.discountPaise : 0;
  const due = h.amountPaise - off;
  return (
    <Page kicker="Almost done" title="How will you pay?" sub={`${d.therapistName} · ${fmtDay(h.start)} · ${fmtTime(h.start)} · ${rupees(due)}`}>
      <Card>
        {coins && coins.coins > 0 && (
          <label className="flex items-center gap-3 rounded-xl bg-canvas px-4 py-3 cursor-pointer">
            <input type="checkbox" checked={useCoins} onChange={e => setUseCoins(e.target.checked)} className="w-5 h-5 accent-brand" />
            <span className="flex-1"><b>Use {coins.coins.toLocaleString('en-IN')} coins</b> · save {rupees(coins.discountPaise)}<span className="block text-xs text-sub">Coins can pay up to {coins.maxPct}% of a booking. 10 coins = ₹1.</span></span>
          </label>
        )}
        <PlanOption on={method === 'upi'} onClick={() => setMethod('upi')} title="UPI · scan our QR" sub="Google Pay, PhonePe, Paytm or any UPI app. Upload the screenshot after paying." price={due} />
        <PlanOption on={method === 'cash'} onClick={() => setMethod('cash')} title="Cash at the visit" sub="Pay your physio. You’ll get a receipt in the app once we confirm it." price={due} />
        <ErrorText error={error} />
        <Button variant="dark" disabled={busy} onClick={confirm}>{busy ? 'Confirming…' : 'Confirm booking'}</Button>
      </Card>
    </Page>
  );
}

// ---------- Payment: QR, reference, upload proof, status ----------
export function PaymentPage() {
  const { id = '' } = useParams();
  const isNew = new URLSearchParams(useLocation().search).get('new') === '1';
  const [p, setP] = useState<Payment | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [utr, setUtr] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.payment(id).then(r => { setP(r.payment); if (r.payment.qrUrl && r.payment.status !== 'paid') api.imageUrl(r.payment.qrUrl).then(setQr).catch(() => undefined); }).catch(e => setError(msg(e)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!utr.trim() && !file) return setError('Add the UPI reference number or the screenshot.');
    setError(null); setBusy(true);
    try {
      const uploaded = file ? await api.upload(file, 'payment_proof') : null;
      await api.upiProof(id, { utr: utr.trim() || undefined, fileId: uploaded?.id });
      await load();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  if (!p) return <Page title="Payment"><ErrorText error={error} />{!error && <p className="text-sub">Loading…</p>}</Page>;
  const label = { pending: 'Waiting for payment', submitted: 'Checking your payment', paid: 'Paid', rejected: 'Needs attention' }[p.status];
  return (
    <Page kicker={isNew ? 'You’re booked' : 'Payment'} title={`${rupees(p.amountPaise)} · ${label}`} sub={`Reference ${p.reference}`}>
      {p.status === 'paid' && <Card><p className="font-bold text-success-ink">Payment confirmed. Invoice {p.invoiceNo}.</p></Card>}
      {p.status === 'rejected' && <Card><p className="font-bold text-danger-ink">We couldn’t confirm this payment.</p><p className="text-sub">{p.reviewNote}</p></Card>}
      {p.method === 'cash' && p.status !== 'paid' && <Card><p className="font-bold">Pay {rupees(p.amountPaise)} in cash to your physio at the visit.</p><p className="text-sub text-sm">They’ll mark it received, and your receipt appears here once we confirm it.</p></Card>}
      {p.method === 'upi' && ['pending', 'rejected'].includes(p.status) && (
        <>
          <Card className="items-center text-center">
            <h2 className="text-xl font-bold">1 · Scan and pay</h2>
            {qr ? <img src={qr} alt={`UPI QR code to pay ${rupees(p.amountPaise)} to ${p.payeeName}`} className="w-64 h-64" /> : <div className="w-64 h-64 rounded-2xl bg-canvas" />}
            <p className="text-sm">Pay <b>{rupees(p.amountPaise)}</b> to <b>{p.upiId}</b> ({p.payeeName})</p>
            <p className="text-sm text-sub">Write <b>{p.reference}</b> in the payment note.</p>
            {p.upiUri && <a href={p.upiUri} className="sm:hidden h-12 px-6 rounded-xl bg-brand text-white font-bold flex items-center">Open UPI app</a>}
          </Card>
          <Card>
            <h2 className="text-xl font-bold">2 · Send us the proof</h2>
            <Field label="UPI reference number (UTR, 12 digits)" value={utr} onChange={e => setUtr(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 32))} inputMode="numeric" />
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">Payment screenshot
              <input type="file" accept="image/png,image/jpeg,image/webp,image/heic,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-ink" />
            </label>
            <ErrorText error={error} />
            <Button disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Submit payment details'}</Button>
          </Card>
        </>
      )}
      {p.status === 'submitted' && <Card><p className="font-bold">Thanks! We’re checking your payment.</p><p className="text-sub text-sm">You’ll get a notification when it’s confirmed, usually within a few hours.</p></Card>}
      <Link to="/bookings" className="text-brand font-bold">My bookings ›</Link>
    </Page>
  );
}

// ---------- My bookings ----------
export function Bookings() {
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  useEffect(() => { api.bookings().then(r => setRows(r.bookings)).catch(e => setError(msg(e))); calendar.me().then(r => setFeed(r.feedUrl)).catch(() => undefined); }, []);
  const joinVideo = async (id: string) => { setError(null); try { const r = await calendar.video(id); window.open(r.url, '_blank', 'noopener'); } catch (e) { setError(msg(e)); } };
  return (
    <Page title="My bookings">
      {info && <p className="rounded-xl bg-success/10 px-4 py-3 font-semibold">{info}</p>}
      <ErrorText error={error} />
      {rows?.length === 0 && <Card><p className="font-bold">No visits yet</p><Link to="/book" className="text-brand font-bold">Book your first visit ›</Link></Card>}
      {rows?.map(b => (
        <Card key={b.id}>
          <div className="flex justify-between flex-wrap gap-2">
            <div><p className="text-lg font-extrabold">{fmtDay(b.starts_at)} · {fmtTime(b.starts_at)}</p><p className="text-sub text-sm">{b.therapist_name} · {b.mode}{b.sessions_total > 1 ? ` · ${b.sessions_total}-session plan` : ''}</p></div>
            <div className="flex items-center gap-2">{b.zone_color && <ZonePill color={b.zone_color as 'green'} name={b.zone_name} />}<span className="text-sm font-bold text-success-ink capitalize">{b.status}</span></div>
          </div>
          {b.payment_id && (
            <Link to={`/payments/${b.payment_id}`} className="text-sm font-bold text-brand">
              {b.payment_method === 'upi' ? 'UPI' : 'Cash'} · {{ pending: 'payment due', submitted: 'checking payment', paid: 'paid', rejected: 'payment needs attention' }[b.payment_status ?? 'pending']} ›
            </Link>
          )}
          <div className="flex gap-4 flex-wrap text-sm font-bold">
            {b.mode === 'video' && ['booked', 'checked_in'].includes(b.status) && <button onClick={() => joinVideo(b.id)} className="text-white bg-brand rounded-lg px-3 py-1.5">Join video call</button>}
            {['booked', 'on_the_way', 'checked_in'].includes(b.status) && <button onClick={() => calendar.addToCalendar(b.id).catch(e => setError(msg(e)))} className="text-brand">Add to calendar</button>}
            {['booked', 'on_the_way', 'checked_in'].includes(b.status) && <button onClick={() => comms.call(b.id).then(r => setInfo(r.message)).catch(e => setError(msg(e)))} className="text-brand">📞 Call physio</button>}
            {b.plan_id && <Link to={`/chat/${b.plan_id}`} className="text-brand">Message physio</Link>}
            {b.status === 'completed' && !b.rated && <Link to={`/visits/${b.id}/rate`} className="text-brand">Rate this visit</Link>}
            {['completed', 'in_progress', 'booked', 'no_show'].includes(b.status) && <Link to={`/visits/${b.id}/report`} className="text-sub underline">Report a problem</Link>}
          </div>
        </Card>
      ))}
      <Link to="/plans" className="text-brand font-bold">My plans and refunds ›</Link>
      {feed && <p className="text-sm text-sub">See every visit in your phone’s calendar: <a href={feed.replace(/^https?:/, 'webcal:')} className="text-brand font-bold">subscribe</a> or copy this private link into Google Calendar › Other calendars › From URL: <button onClick={() => navigator.clipboard.writeText(feed)} className="text-brand font-bold underline">copy link</button></p>}
    </Page>
  );
}
