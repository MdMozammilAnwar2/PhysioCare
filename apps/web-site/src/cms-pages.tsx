// Public website pages served from the CMS, the physio directory, and the editors' draft preview.
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, cms, fileUrl, rupees, type CmsPage, type PublicPhysio } from './api';
import { captureAttribution } from './booking-state';
import { Blocks, PhysioCard } from './blocks';
import { Page } from './ui';

const SITE = 'PhysioCare';
/** Title, description and social preview for the current page (search engines and WhatsApp/Facebook link cards). */
export function useSeo({ title, description, image, noindex }: { title?: string; description?: string | null; image?: string | null; noindex?: boolean }) {
  useEffect(() => {
    document.title = title ? (title.includes(SITE) ? title : `${title} | ${SITE}`) : `${SITE} · Physiotherapy at home in Patna`;
    const set = (attr: 'name' | 'property', key: string, value?: string | null) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!value) { el?.remove(); return; }
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
      el.content = value;
    };
    set('name', 'description', description ?? undefined);
    set('property', 'og:title', document.title);
    set('property', 'og:description', description ?? undefined);
    set('property', 'og:image', image ? new URL(image, location.origin).toString() : `${location.origin}/icon-512.png`);
    set('name', 'robots', noindex ? 'noindex' : undefined);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
    canonical.href = location.origin + location.pathname;
  }, [title, description, image, noindex]);
}

function NotFound() {
  useSeo({ title: 'Page not found', noindex: true });
  return <Page title="Page not found" sub="The page you’re looking for has moved or doesn’t exist."><Link to="/" className="text-brand font-bold">Go to the home page ›</Link></Page>;
}

function Render({ page }: { page: CmsPage }) {
  useSeo({ title: page.seo?.title || page.title, description: page.seo?.description || page.summary, image: page.seo?.imageFileId ? fileUrl(page.seo.imageFileId) : page.cover_file_id ? fileUrl(page.cover_file_id) : null, noindex: page.seo?.noindex });
  const hasHero = page.blocks[0]?.type === 'hero';
  return (
    <div className="flex flex-col gap-6 pt-2">
      {!hasHero && (
        <header className="max-w-6xl w-full mx-auto px-4 pt-8">
          {page.kind === 'legal' && <p className="text-sm text-sub font-semibold">Legal</p>}
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">{page.title}</h1>
          {page.summary && <p className="mt-3 text-lg text-sub max-w-2xl">{page.summary}</p>}
          {page.kind === 'blog' && page.published_at && <p className="mt-2 text-sm text-sub">{new Date(page.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
        </header>
      )}
      <Blocks blocks={page.blocks} />
    </div>
  );
}

/** Any URL that isn't an app screen: looks the path up in the CMS. "/" is the home page. */
export function CmsRoute() {
  const loc = useLocation();
  const [page, setPage] = useState<CmsPage | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { captureAttribution(loc.search); }, [loc.search]);
  useEffect(() => {
    setPage(null); setMissing(false);
    cms.page(loc.pathname).then(r => setPage(r.page)).catch(e => { if (e instanceof ApiError && e.status === 404) setMissing(true); });
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  if (missing) return <NotFound />;
  if (!page) return <div className="max-w-6xl mx-auto px-4 py-20"><div className="h-64 rounded-[32px] bg-mist animate-pulse" /></div>;
  return <Render page={page} />;
}

/** Editors: see a draft before publishing (sign in on the website with a staff account). */
export function Preview() {
  const [params] = useSearchParams();
  const [page, setPage] = useState<CmsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { cms.preview(params.get('path') ?? '').then(r => setPage(r.page)).catch(e => setError(e instanceof ApiError ? (e.status === 401 || e.status === 403 ? 'Sign in on the website with a staff account to preview drafts.' : e.message) : 'Couldn’t load the preview.')); }, [params]);
  if (error) return <Page title="Preview"><p className="text-danger-ink font-semibold">{error}</p><Link to={`/signin?next=${encodeURIComponent(`/preview?path=${params.get('path') ?? ''}`)}`} className="text-brand font-bold">Sign in ›</Link></Page>;
  if (!page) return null;
  return (
    <>
      <div className="bg-warning text-ink text-sm font-bold text-center py-2">Preview of the draft. Visitors still see the published version.</div>
      <Render page={{ ...page, seo: { ...page.seo, noindex: true } }} />
    </>
  );
}

const SPECIALITIES = ['ortho', 'neuro', 'sports', 'geriatric', 'post_surgery', 'paediatric', 'women_health', 'cardio'];
export function PhysioDirectory() {
  const [spec, setSpec] = useState('');
  const [list, setList] = useState<PublicPhysio[] | null>(null);
  useSeo({ title: 'Verified physiotherapists in Patna', description: 'Qualified, police-verified physiotherapists who visit your home in Patna. See experience, ratings and prices.' });
  useEffect(() => { setList(null); cms.physios(60, spec).then(r => setList(r.physios)).catch(() => setList([])); }, [spec]);
  return (
    <Page kicker="Patna" title="Our physiotherapists" sub="Every physio is qualified (BPT/MPT), council-registered, police-verified and trained in our safety rules.">
      <div className="flex gap-2 flex-wrap">
        {[['', 'All'], ...SPECIALITIES.map(x => [x, x.replace('_', ' ')])].map(([v, l]) => (
          <button key={v} onClick={() => setSpec(v)} className={`min-h-11 px-4 rounded-full text-sm font-bold capitalize ${spec === v ? 'bg-ink text-white' : 'bg-white border border-line'}`}>{l}</button>
        ))}
      </div>
      {list === null && <p className="text-sub">Loading…</p>}
      {list?.length === 0 && <p className="text-sub">No physiotherapists listed for this yet. <Link to="/book" className="text-brand font-bold">Book and we’ll match you ›</Link></p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{list?.map(p => <PhysioCard key={p.id} p={p} />)}</div>
    </Page>
  );
}

const TAG: Record<string, string> = { on_time: 'On time', explained_clearly: 'Explained clearly', respectful: 'Respectful', felt_better: 'I feel better', too_rushed: 'Too rushed', late: 'Came late' };
export function PhysioProfile() {
  const { id = '' } = useParams();
  const [d, setD] = useState<Awaited<ReturnType<typeof cms.physio>> | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { cms.physio(id).then(setD).catch(() => setMissing(true)); }, [id]);
  useSeo({ title: d ? `${d.physio.name}, ${d.physio.qualification ?? 'Physiotherapist'} in Patna` : undefined, description: d?.physio.bio?.slice(0, 160) ?? undefined });
  if (missing) return <NotFound />;
  if (!d) return null;
  const p = d.physio;
  return (
    <Page kicker={`${p.qualification ?? 'Physiotherapist'}${p.years_experience ? ` · ${p.years_experience} years` : ''}`} title={p.name}>
      <div className="rounded-card bg-white border border-line p-6 flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {p.rating && <span><b className="text-lg">★ {p.rating.toFixed(1)}</b> <span className="text-sub">({p.reviews} ratings)</span></span>}
          <span className="text-sub"><b className="text-ink">{p.sessions}</b> sessions on PhysioCare</span>
          {p.from_paise && <span className="text-sub">From <b className="text-ink">{rupees(p.from_paise)}</b> a session</span>}
        </div>
        {p.bio && <p className="text-[17px] leading-relaxed">{p.bio}</p>}
        {p.specialisations.length > 0 && <div className="flex flex-wrap gap-2">{p.specialisations.map(x => <span key={x} className="rounded-full bg-mist text-brand font-semibold px-3 py-1 text-sm capitalize">{x.replace('_', ' ')}</span>)}</div>}
        {p.languages.length > 0 && <p className="text-sm text-sub">Speaks: {p.languages.map(l => ({ hi: 'Hindi', en: 'English', bho: 'Bhojpuri', mai: 'Maithili', ur: 'Urdu', mag: 'Magahi' }[l] ?? l)).join(', ')}</p>}
        <p className="text-sm text-sub">✓ Degree and council registration checked · ✓ Police verification · ✓ Signed our safety agreement</p>
        <Link to="/book" className="min-h-12 px-6 rounded-xl bg-brand text-white font-bold inline-flex items-center justify-center self-start">Book a visit</Link>
      </div>
      {d.reviews.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-extrabold">What patients say</h2>
          {d.reviews.map((r, i) => (
            <figure key={i} className="rounded-card bg-white border border-line p-5 flex flex-col gap-2">
              <p className="text-warning font-bold">{'★'.repeat(r.stars)}<span className="text-line">{'★'.repeat(5 - r.stars)}</span></p>
              <blockquote>“{r.comment}”</blockquote>
              <figcaption className="text-sm text-sub">{r.first_name} · {new Date(r.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}{r.tags.length ? ` · ${r.tags.map(t => TAG[t] ?? t).join(', ')}` : ''}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </Page>
  );
}
