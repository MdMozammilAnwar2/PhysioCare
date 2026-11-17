import { useEffect, useState } from 'react';

type Status = { status: string; version: string; maintenance: { enabled: boolean; message: string | null } };

// Phase 0 shell of the public website: Style A hero + the shared status check.
export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    const check = () => fetch('/api/v1/status').then(r => r.json()).then(s => { setStatus(s); setDown(false); }).catch(() => setDown(true));
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {down && <div className="bg-danger text-white text-sm font-semibold px-4 py-2 text-center">We’re having trouble connecting. Booked visits are not affected.</div>}
      {status?.maintenance.enabled && <div className="bg-warning text-navy text-sm font-semibold px-4 py-2 text-center">{status.maintenance.message ?? 'Scheduled maintenance in progress.'}</div>}
      <nav className="max-w-6xl mx-auto px-6 py-5 flex items-center gap-8 text-[15px] font-medium">
        <span className="flex items-center gap-2.5 text-xl font-extrabold"><span className="w-7 h-7 rounded-lg bg-brand" />PhysioConnect</span>
        <a href="#" className="hidden sm:inline">Find a physio</a>
        <a href="#" className="hidden sm:inline">Conditions</a>
        <a href="#" className="hidden sm:inline">Pricing</a>
        <span className="flex-1" />
        <a href="#" className="h-11 px-5 rounded-xl bg-navy text-white font-bold flex items-center">Book a visit</a>
      </nav>
      <section className="max-w-6xl mx-auto px-4">
        <div className="rounded-[32px] bg-hero text-white text-center px-6 pt-24 pb-24">
          <span className="inline-block rounded-full bg-white/20 px-4 py-1.5 text-sm font-bold">Now in Patna</span>
          <h1 className="mt-6 mx-auto max-w-3xl text-5xl sm:text-7xl font-extrabold leading-[1.03] tracking-tight">Physiotherapy. At home. Near you.</h1>
          <p className="mt-5 mx-auto max-w-xl text-lg sm:text-xl text-white/90">Verified physiotherapists matched to your home, your recovery and your choice of therapist.</p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <a href="#" className="h-14 px-7 rounded-2xl bg-white text-navy font-bold flex items-center shadow-lg">Find a physiotherapist</a>
            <a href="#" className="h-14 px-7 rounded-2xl border-[1.5px] border-white/70 font-bold flex items-center">What we treat</a>
          </div>
        </div>
      </section>
      <footer className="max-w-6xl mx-auto px-6 py-10 text-sm text-sub">PhysioConnect by Healthtropic · v{status?.version ?? '—'}</footer>
    </div>
  );
}
