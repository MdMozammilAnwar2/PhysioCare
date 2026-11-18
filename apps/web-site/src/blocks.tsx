// Renders CMS blocks (see packages/shared/cms.js for the types and their fields).
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, cms, fileUrl, grievance, rupees, type CmsBlock, type Officer, type PageCard, type PublicPhysio, type Zone } from './api';
import { ZonePill } from './ui';

// ---------- tiny, safe Markdown: paragraphs, ## headings, - lists, 1. lists, **bold**, *italic*, [links](/x). No HTML. ----------
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('[')) {
      const [, label, href] = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      const safe = /^(\/|https?:\/\/|mailto:|tel:|#)/.test(href) ? href : '#';
      out.push(safe.startsWith('/') ? <Link key={`${key}-${i++}`} to={safe} className="text-brand font-semibold underline">{label}</Link>
        : <a key={`${key}-${i++}`} href={safe} className="text-brand font-semibold underline" rel="noreferrer" target={safe.startsWith('http') ? '_blank' : undefined}>{label}</a>);
    } else out.push(<em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const parts = String(text ?? '').replace(/\r/g, '').split(/\n{2,}/);
  return (
    <div className={`flex flex-col gap-3 text-[17px] leading-relaxed ${className}`}>
      {parts.map((p, i) => {
        const lines = p.split('\n');
        if (/^#{2,3} /.test(p)) return <h3 key={i} className="text-xl font-extrabold mt-2">{inline(p.replace(/^#{2,3} /, ''), i)}</h3>;
        if (lines.every(l => /^[-*] /.test(l))) return <ul key={i} className="list-disc pl-6 flex flex-col gap-1">{lines.map((l, j) => <li key={j}>{inline(l.slice(2), j)}</li>)}</ul>;
        if (lines.every(l => /^\d+\. /.test(l))) return <ol key={i} className="list-decimal pl-6 flex flex-col gap-1">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\d+\. /, ''), j)}</li>)}</ol>;
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, j)}</Fragment>)}</p>;
      })}
    </div>
  );
}

const s = (v: unknown) => (typeof v === 'string' ? v : '');
const items = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const Section = ({ children, className = '' }: { children: ReactNode; className?: string }) => <section className={`max-w-6xl w-full mx-auto px-4 ${className}`}>{children}</section>;
const H2 = ({ children }: { children: ReactNode }) => <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{children}</h2>;
function Btn({ href, children, tone = 'primary' }: { href: string; children: ReactNode; tone?: 'primary' | 'light' | 'outline' }) {
  const cls = `min-h-12 px-6 rounded-2xl font-bold inline-flex items-center justify-center ${{ primary: 'bg-brand text-white', light: 'bg-white text-ink shadow-lg', outline: 'border-[1.5px] border-white/70 text-white' }[tone]}`;
  return href.startsWith('/') ? <Link to={href} className={cls}>{children}</Link> : <a href={href} className={cls}>{children}</a>;
}

function Hero({ b }: { b: CmsBlock }) {
  const img = s(b.imageFileId);
  return (
    <Section className="pt-4">
      <div className="relative overflow-hidden rounded-[32px] bg-hero text-white text-center px-6 py-20 sm:py-24">
        {img && <img src={fileUrl(img)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25" />}
        <div className="relative">
          {s(b.badge) && <span className="inline-block rounded-full bg-white/20 px-4 py-1.5 text-sm font-bold">{s(b.badge)}</span>}
          <h1 className="mt-6 mx-auto max-w-3xl text-4xl sm:text-6xl font-extrabold leading-[1.05] tracking-tight">{s(b.heading)}</h1>
          {s(b.sub) && <p className="mt-5 mx-auto max-w-xl text-lg sm:text-xl text-white/90">{s(b.sub)}</p>}
          {(s(b.ctaLabel) || s(b.secondaryLabel)) && (
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              {s(b.ctaLabel) && <Btn href={s(b.ctaHref) || '/book'} tone="light">{s(b.ctaLabel)}</Btn>}
              {s(b.secondaryLabel) && <Btn href={s(b.secondaryHref) || '/'} tone="outline">{s(b.secondaryLabel)}</Btn>}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function PhysioList({ b }: { b: CmsBlock }) {
  const [list, setList] = useState<PublicPhysio[] | null>(null);
  useEffect(() => { cms.physios(Number(b.limit) || 6).then(r => setList(r.physios)).catch(() => setList([])); }, [b.limit]);
  if (list && list.length === 0) return null;
  return (
    <Section className="flex flex-col gap-5">
      {s(b.heading) && <H2>{s(b.heading)}</H2>}
      {s(b.sub) && <p className="text-sub text-lg -mt-2">{s(b.sub)}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{(list ?? []).map(p => <PhysioCard key={p.id} p={p} />)}</div>
      <Link to="/physios" className="text-brand font-bold">See all physiotherapists ›</Link>
    </Section>
  );
}
export function PhysioCard({ p }: { p: PublicPhysio }) {
  const initials = p.name.split(' ').map(w => w[0]).slice(0, 2).join('');
  return (
    <Link to={`/physios/${p.id}`} className="rounded-card bg-white border border-line p-5 flex gap-4 hover:border-brand transition-colors">
      <span className="w-14 h-14 shrink-0 rounded-2xl bg-mist text-brand font-extrabold text-lg flex items-center justify-center">{initials}</span>
      <span className="flex flex-col gap-1 min-w-0">
        <span className="font-extrabold text-lg">{p.name}</span>
        <span className="text-sm text-sub">{p.qualification}{p.years_experience ? ` · ${p.years_experience} yrs` : ''}{p.rating ? ` · ★ ${p.rating.toFixed(1)} (${p.reviews})` : ''}</span>
        {p.specialisations.length > 0 && <span className="text-sm truncate">{p.specialisations.slice(0, 3).join(' · ')}</span>}
        {p.from_paise && <span className="text-sm font-bold text-brand">From {rupees(p.from_paise)} a session</span>}
      </span>
    </Link>
  );
}

function Zones({ b }: { b: CmsBlock }) {
  const [zones, setZones] = useState<Zone[] | null>(null);
  useEffect(() => { api.zones().then(r => setZones(r.zones)).catch(() => setZones([])); }, []);
  const order = ['green', 'blue', 'yellow', 'orange', 'red'];
  return (
    <Section className="flex flex-col gap-4">
      {s(b.heading) && <H2>{s(b.heading)}</H2>}
      {s(b.sub) && <p className="text-sub text-lg -mt-1">{s(b.sub)}</p>}
      <div className="flex flex-wrap gap-2">{(zones ?? []).filter(z => z.color !== 'red').sort((a, c) => order.indexOf(a.color) - order.indexOf(c.color)).map(z => <ZonePill key={z.id} color={z.color} name={z.name} />)}</div>
    </Section>
  );
}

function PageList({ b }: { b: CmsBlock }) {
  const [pages, setPages] = useState<PageCard[] | null>(null);
  useEffect(() => { cms.pages(s(b.kind), Number(b.limit) || 20).then(r => setPages(r.pages)).catch(() => setPages([])); }, [b.kind, b.limit]);
  return (
    <Section className="flex flex-col gap-4">
      {s(b.heading) && <H2>{s(b.heading)}</H2>}
      {pages?.length === 0 && <p className="text-sub">Coming soon.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {pages?.map(p => (
          <Link key={p.slug} to={`/${p.slug}`} className="rounded-card bg-white border border-line overflow-hidden hover:border-brand transition-colors flex flex-col">
            {p.cover_file_id && <img src={fileUrl(p.cover_file_id)} alt="" className="w-full aspect-[16/9] object-cover" />}
            <span className="p-5 flex flex-col gap-1.5">
              <span className="font-extrabold text-lg">{p.title}</span>
              {p.summary && <span className="text-sub text-sm">{p.summary}</span>}
              {b.kind === 'blog' && <span className="text-xs text-sub">{new Date(p.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
            </span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

function GrievanceBlock({ b }: { b: CmsBlock }) {
  const [o, setO] = useState<Officer | null>(null);
  useEffect(() => { grievance.officer().then(r => setO(r.officer)).catch(() => undefined); }, []);
  if (!o) return null;
  return (
    <Section>
      <div className="rounded-card bg-white border border-line p-6 flex flex-col gap-1">
        <p className="text-sm text-sub font-semibold">{s(b.heading) || o.designation}</p>
        <p className="text-xl font-extrabold">{o.name}</p>
        {o.email && <a href={`mailto:${o.email}`} className="text-brand font-bold">{o.email}</a>}
        {o.phone && <a href={`tel:${o.phone}`} className="text-brand font-bold">{o.phone}</a>}
        <p className="text-sub">{o.address} · {o.hours}</p>
        <Link to="/grievance" className="text-brand font-bold mt-2">File or follow a complaint ›</Link>
      </div>
    </Section>
  );
}

function youtubeId(url: string) { const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/); return m?.[1] ?? null; }

export function Block({ b }: { b: CmsBlock }) {
  switch (b.type) {
    case 'hero': return <Hero b={b} />;
    case 'text': return <Section className="max-w-3xl">{s(b.heading) && <h2 className="text-3xl font-extrabold tracking-tight mb-4">{s(b.heading)}</h2>}<Markdown text={s(b.body)} /></Section>;
    case 'image': return <Section><figure className="flex flex-col gap-2"><img src={fileUrl(s(b.imageFileId))} alt={s(b.alt)} className="w-full rounded-card" loading="lazy" />{s(b.caption) && <figcaption className="text-sm text-sub">{s(b.caption)}</figcaption>}</figure></Section>;
    case 'video': {
      const yt = youtubeId(s(b.youtubeUrl));
      return (
        <Section className="flex flex-col gap-2">
          {yt ? <iframe className="w-full aspect-video rounded-card" src={`https://www.youtube-nocookie.com/embed/${yt}`} title={s(b.caption) || 'Video'} allow="encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
            : s(b.videoFileId) ? <video className="w-full rounded-card" src={fileUrl(s(b.videoFileId))} controls preload="metadata" /> : null}
          {s(b.caption) && <p className="text-sm text-sub">{s(b.caption)}</p>}
        </Section>
      );
    }
    case 'cards': return (
      <Section className="flex flex-col gap-5">
        {s(b.heading) && <H2>{s(b.heading)}</H2>}
        {s(b.sub) && <p className="text-sub text-lg -mt-2">{s(b.sub)}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items(b.items).map((c, i) => {
            const body = <><span className="text-3xl">{s(c.icon)}</span><span className="font-extrabold text-lg">{s(c.title)}</span>{s(c.body) && <span className="text-sub">{s(c.body)}</span>}{s(c.href) && <span className="text-brand font-bold text-sm mt-auto">Learn more ›</span>}</>;
            const cls = 'rounded-card bg-white border border-line p-6 flex flex-col gap-2 hover:border-brand transition-colors';
            return s(c.href) ? <Link key={i} to={s(c.href)} className={cls}>{body}</Link> : <div key={i} className={cls}>{body}</div>;
          })}
        </div>
      </Section>
    );
    case 'steps': return (
      <Section className="flex flex-col gap-5">
        {s(b.heading) && <H2>{s(b.heading)}</H2>}
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {items(b.items).map((st, i) => <li key={i} className="rounded-card bg-white border border-line p-6 flex flex-col gap-2"><span className="w-9 h-9 rounded-full bg-brand text-white font-extrabold flex items-center justify-center">{i + 1}</span><span className="font-extrabold text-lg">{s(st.title)}</span><span className="text-sub">{s(st.body)}</span></li>)}
        </ol>
      </Section>
    );
    case 'stats': return <Section><div className="grid grid-cols-2 lg:grid-cols-4 gap-4 rounded-card bg-mist p-6">{items(b.items).map((x, i) => <div key={i}><p className="text-2xl sm:text-3xl font-extrabold text-brand">{s(x.value)}</p><p className="text-sm text-sub font-semibold">{s(x.label)}</p></div>)}</div></Section>;
    case 'faq': return (
      <Section className="max-w-3xl flex flex-col gap-3">
        {s(b.heading) && <H2>{s(b.heading)}</H2>}
        {items(b.items).map((f, i) => (
          <details key={i} className="rounded-card bg-white border border-line px-5 py-4 group">
            <summary className="font-bold text-lg cursor-pointer list-none flex justify-between gap-4">{s(f.q)}<span className="text-brand group-open:rotate-45 transition-transform">+</span></summary>
            <Markdown text={s(f.a)} className="mt-3 text-sub" />
          </details>
        ))}
      </Section>
    );
    case 'testimonials': return (
      <Section className="flex flex-col gap-5">
        {s(b.heading) && <H2>{s(b.heading)}</H2>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{items(b.items).map((t, i) => <figure key={i} className="rounded-card bg-white border border-line p-6 flex flex-col gap-3"><blockquote className="text-lg">“{s(t.quote)}”</blockquote><figcaption className="text-sm"><b>{s(t.name)}</b>{s(t.detail) && <span className="text-sub"> · {s(t.detail)}</span>}</figcaption></figure>)}</div>
      </Section>
    );
    case 'cta': return (
      <Section>
        <div className="rounded-[28px] bg-ink text-white px-6 py-12 text-center flex flex-col gap-4 items-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{s(b.heading)}</h2>
          {s(b.sub) && <p className="text-white/80 text-lg max-w-xl">{s(b.sub)}</p>}
          <Btn href={s(b.href) || '/book'}>{s(b.label)}</Btn>
        </div>
      </Section>
    );
    case 'notice': return <Section className="max-w-3xl"><div className={`rounded-xl px-5 py-4 ${b.tone === 'warning' ? 'bg-warning/15 border border-warning/40' : 'bg-mist border border-lavender/40'}`}><Markdown text={s(b.body)} className="text-base" /></div></Section>;
    case 'physios': return <PhysioList b={b} />;
    case 'zones': return <Zones b={b} />;
    case 'pageList': return <PageList b={b} />;
    case 'grievance': return <GrievanceBlock b={b} />;
    default: return null;
  }
}

export const Blocks = ({ blocks }: { blocks: CmsBlock[] }) => <div className="flex flex-col gap-14 pb-10">{blocks.map(b => <Block key={b.id} b={b} />)}</div>;
