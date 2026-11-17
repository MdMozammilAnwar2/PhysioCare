import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, isSignedIn, payWithRazorpay, rupees, type Booking, type Match, type Package, type Zone } from './api';
import { captureAttribution, draft, pendingAttribution } from './booking-state';
import { Button, Card, Chips, ErrorText, Field, Page, ZonePill } from './ui';

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
export function Home() {
  const loc = useLocation();
  useEffect(() => captureAttribution(loc.search), [loc.search]);
  return (
    <section className="max-w-6xl mx-auto px-4 pt-4">
      <div className="rounded-[32px] bg-hero text-white text-center px-6 py-24">
        <span className="inline-block rounded-full bg-white/20 px-4 py-1.5 text-sm font-bold">Now in Patna</span>
        <h1 className="mt-6 mx-auto max-w-3xl text-5xl sm:text-7xl font-extrabold leading-[1.03] tracking-tight">Physiotherapy. At home. Near you.</h1>
        <p className="mt-5 mx-auto max-w-xl text-lg sm:text-xl text-white/90">Verified physiotherapists matched to your home, your recovery and your choice of therapist.</p>
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <Link to="/book" className="h-14 px-7 rounded-2xl bg-white text-navy font-bold flex items-center shadow-lg">Find a physiotherapist</Link>
          <Link to="/signin" className="h-14 px-7 rounded-2xl border-[1.5px] border-white/70 font-bold flex items-center">I have a doctor’s code</Link>
        </div>
      </div>
    </section>
  );
}

// ---------- Sign in (phone → OTP) ----------
export function SignIn() {
  const nav = useNavigate();
  const loc = useLocation();
  const next = new URLSearchParams(loc.search).get('next') || '/book';
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [ref, setRef] = useState(pendingAttribution().ref ?? '');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      if (step === 'phone') { await api.sendOtp(phone); setStep('code'); return; }
      const att = pendingAttribution();
      const r = await api.verifyOtp(phone, code, { ref: ref.trim() || undefined, utm: att.utm });
      localStorage.removeItem('pc.attribution');
      nav(r.isNew || !r.user.name ? `/about-you?next=${encodeURIComponent(next)}` : next);
    } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  }
  return (
    <Page title={step === 'phone' ? 'Sign in or create an account' : 'Enter the code'} sub={step === 'phone' ? 'No password needed. We text you a 6-digit code.' : `Sent to +91 ${phone}.`}>
      <form onSubmit={submit} className="contents">
        <Card>
          {step === 'phone' ? (
            <>
              <Field label="Mobile number" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="98765 43210" required />
              <Field label="Doctor’s or friend’s referral code (optional)" value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. K7MP-4QXR or ROHIT25" />
            </>
          ) : (
            <Field label="6-digit code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required />
          )}
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
  useEffect(() => { api.zones().then(r => setZones(r.zones)).catch(() => undefined); }, []);

  async function useLocation_() {
    navigator.geolocation?.getCurrentPosition(p => save(p.coords.latitude, p.coords.longitude), () => setError('Couldn’t get your location. Pick your area instead.'));
  }
  async function save(lat?: number, lng?: number) {
    setError(null);
    const z = zones.find(z => z.id === area);
    if (lat === undefined && !z) return setError('Pick your area.');
    if (line1.trim().length < 5) return setError('Enter your house and street.');
    try { setResult(await api.addAddress({ line1, landmark: landmark || undefined, lat: lat ?? z!.lat!, lng: lng ?? z!.lng! })); } catch (e) { setError(msg(e)); }
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
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">Area in Patna
              <select value={area} onChange={e => setArea(e.target.value)} className="h-12 rounded-xl border border-line bg-white px-4 text-base text-ink">
                <option value="">Choose your area</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
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
      const me = await api.me();
      const done = await payWithRazorpay(hold, { contact: me.user.phone, name: me.user.name ?? undefined });
      draft.set({ confirmation: { ...done, start: slot, amountPaise: hold.amountPaise } });
      nav('/book/done');
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
        <Button variant="dark" disabled={busy || !slot} onClick={pay}>{busy ? 'Processing…' : `Pay ${rupees(amount)}`}</Button>
        <p className="text-xs text-sub">UPI, card or net banking via Razorpay. Your slot is held for 10 minutes. Each visit is protected for 7 days.</p>
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

// ---------- Done ----------
export function Done() {
  const d = draft.get();
  const c = d.confirmation;
  if (!c) return <Navigate to="/bookings" replace />;
  return (
    <Page kicker="Booking confirmed" title={c.needsNewTime ? 'Payment received · pick a new time' : 'You’re booked'} sub={`Payment of ${rupees(c.amountPaise)} received. Invoice ${c.invoiceNo}.`}>
      <Card>
        <p><b>Physio:</b> {d.therapistName}</p>
        <p><b>First visit:</b> {fmtDay(c.start)} · {fmtTime(c.start)}</p>
        <p className="text-sm text-sub">On the day you’ll get a 4-digit check-in code. Share it only when your physio arrives.</p>
        <Link to="/bookings" onClick={() => draft.clear()} className="h-12 rounded-xl bg-navy text-white font-bold flex items-center justify-center">My bookings</Link>
      </Card>
    </Page>
  );
}

// ---------- My bookings ----------
export function Bookings() {
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.bookings().then(r => setRows(r.bookings)).catch(e => setError(msg(e))); }, []);
  return (
    <Page title="My bookings">
      <ErrorText error={error} />
      {rows?.length === 0 && <Card><p className="font-bold">No visits yet</p><Link to="/book" className="text-brand font-bold">Book your first visit ›</Link></Card>}
      {rows?.map(b => (
        <Card key={b.id}>
          <div className="flex justify-between flex-wrap gap-2">
            <div><p className="text-lg font-extrabold">{fmtDay(b.starts_at)} · {fmtTime(b.starts_at)}</p><p className="text-sub text-sm">{b.therapist_name} · {b.mode}{b.sessions_total > 1 ? ` · ${b.sessions_total}-session plan` : ''}</p></div>
            <div className="flex items-center gap-2">{b.zone_color && <ZonePill color={b.zone_color as 'green'} name={b.zone_name} />}<span className="text-sm font-bold text-success-ink capitalize">{b.status}</span></div>
          </div>
        </Card>
      ))}
    </Page>
  );
}
