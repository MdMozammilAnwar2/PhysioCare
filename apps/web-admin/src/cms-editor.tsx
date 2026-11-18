// Website › Pages and Site settings. Forms are generated from the block definitions in packages/shared/cms.js.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BLOCK_TYPES, PAGE_KIND_LABEL, PAGE_KINDS, type Field } from '@physioconnect/shared/cms';
import { ApiError, cmsApi, publicFileUrl, when, type CmsBlock, type CmsPageFull, type CmsPageRow, type SiteSettings } from './api';
import { Header } from './pages';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const input = 'h-11 rounded-xl border border-line px-3 text-ink text-base bg-white w-full';
const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <section className={`rounded-card bg-white border border-line p-5 ${className}`}>{children}</section>;
const Btn = ({ tone = 'dark', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'dark' | 'brand' | 'ghost' | 'danger' }) => (
  <button type="button" {...p} className={`h-10 px-4 rounded-xl font-bold text-sm disabled:opacity-50 ${{ dark: 'bg-navy text-white', brand: 'bg-brand text-white', ghost: 'bg-white border border-line', danger: 'bg-white border border-danger/40 text-danger-ink' }[tone]} ${p.className ?? ''}`} />
);
const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="text-sm font-semibold text-danger-ink">{e}</p> : null);
const newId = () => Math.random().toString(36).slice(2, 10);
const siteUrl = (base: string, slug: string) => `${base.replace(/\/$/, '')}/${slug}`;

// ---------- page list ----------
export function CmsPages() {
  const [kind, setKind] = useState('');
  const [rows, setRows] = useState<CmsPageRow[] | null>(null);
  const [base, setBase] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  useEffect(() => { cmsApi.meta().then(m => setBase(m.siteUrl)).catch(() => undefined); }, []);
  useEffect(() => { setRows(null); cmsApi.pages(kind || undefined).then(r => setRows(r.pages)).catch(e => setErr(msg(e))); }, [kind]);
  async function create() {
    const k = kind || 'page';
    const title = window.prompt(`Title of the new ${PAGE_KIND_LABEL[k].toLowerCase()}`);
    if (!title?.trim()) return;
    const prefix = { service: 'services/', condition: 'conditions/', blog: 'blog/', legal: 'legal/', city: '', page: '' }[k] ?? '';
    const slug = prefix + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    try { const r = await cmsApi.create({ slug, kind: k, title: title.trim(), blocks: [{ id: newId(), type: 'text', body: 'Write here.' }], seo: {} }); nav(`/website/pages/${r.id}`); } catch (e) { setErr(msg(e)); }
  }
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Website" title="Pages" right={<Btn tone="brand" onClick={create}>New {PAGE_KIND_LABEL[kind || 'page'].toLowerCase()}</Btn>} />
      <div className="flex gap-2 flex-wrap">{[['', 'All'], ...PAGE_KINDS.map(k => [k, PAGE_KIND_LABEL[k]])].map(([v, l]) => (
        <button key={v} onClick={() => setKind(v)} className={`h-10 px-4 rounded-full text-sm font-bold ${kind === v ? 'bg-navy text-white' : 'bg-white border border-line'}`}>{l}</button>
      ))}</div>
      <p className="text-sm text-sub">Edits are saved as drafts. Visitors see a change only after you press <b>Publish</b>. Every version is kept and can be restored.</p>
      <Err e={err} />
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-sub text-left"><tr>{['Page', 'Address', 'Type', 'Status', 'Last edit', ''].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className="px-4 py-6 text-sub">Loading…</td></tr>}
            {rows?.map(p => (
              <tr key={p.id} className="border-t border-line">
                <td className="px-4 py-3 font-bold">{p.title}</td>
                <td className="px-4 py-3 font-mono text-xs">{base ? <a href={siteUrl(base, p.slug)} target="_blank" rel="noreferrer" className="text-brand">/{p.slug}</a> : `/${p.slug}`}</td>
                <td className="px-4 py-3">{PAGE_KIND_LABEL[p.kind] ?? p.kind}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${p.status === 'published' ? 'bg-success/15 text-success-ink' : p.status === 'archived' ? 'bg-canvas text-sub' : 'bg-warning/20 text-warning-ink'}`}>{p.status}</span>{p.unpublished_changes && <span className="ml-2 text-xs text-warning-ink font-semibold">unpublished edits</span>}</td>
                <td className="px-4 py-3">{when(p.updated_at)}<div className="text-sub">{p.updated_by_name ?? ''}</div></td>
                <td className="px-4 py-3 text-right"><Link to={`/website/pages/${p.id}`} className="font-bold text-brand">Edit ›</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- field editors ----------
function Upload({ value, onChange, kind }: { value: string; onChange: (v: string) => void; kind: 'image' | 'video' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {value && (kind === 'image' ? <img src={publicFileUrl(value)} alt="" className="h-16 w-24 object-cover rounded-lg border border-line" /> : <video src={publicFileUrl(value)} className="h-16 rounded-lg" />)}
      <label className="h-10 px-4 rounded-xl border border-line font-bold text-sm inline-flex items-center cursor-pointer bg-white">
        {busy ? 'Uploading…' : value ? 'Replace' : `Upload ${kind}`}
        <input type="file" className="sr-only" accept={kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/quicktime'} disabled={busy}
          onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); setErr(null); try { onChange((await cmsApi.upload(f)).id); } catch (x) { setErr(msg(x)); } finally { setBusy(false); } }} />
      </label>
      {value && <button type="button" onClick={() => onChange('')} className="text-sm text-danger-ink font-bold">Remove</button>}
      <Err e={err} />
    </div>
  );
}

function FieldEditor({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  const label = <span className="text-sm font-semibold text-sub">{f.label}{f.required ? ' *' : ''}</span>;
  const str = typeof value === 'string' ? value : '';
  switch (f.kind) {
    case 'textarea': return <label className="flex flex-col gap-1">{label}<textarea value={str} maxLength={f.max} rows={3} onChange={e => onChange(e.target.value)} className="rounded-xl border border-line p-3" /></label>;
    case 'markdown': return (
      <label className="flex flex-col gap-1">{label}
        <textarea value={str} maxLength={f.max} rows={8} onChange={e => onChange(e.target.value)} className="rounded-xl border border-line p-3 font-mono text-sm" />
        <span className="text-xs text-sub">Blank line = new paragraph · ## Heading · - list item · **bold** · *italic* · [link text](/page)</span>
      </label>
    );
    case 'number': return <label className="flex flex-col gap-1 max-w-[160px]">{label}<input type="number" min={f.min} max={f.max} value={typeof value === 'number' ? value : ''} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} className={input} /></label>;
    case 'select': return <label className="flex flex-col gap-1 max-w-xs">{label}<select value={str} onChange={e => onChange(e.target.value)} className={input}><option value="">Choose…</option>{f.options?.map(o => <option key={o} value={o}>{PAGE_KIND_LABEL[o] ?? o}</option>)}</select></label>;
    case 'image': case 'video': return <div className="flex flex-col gap-1">{label}<Upload kind={f.kind} value={str} onChange={onChange} /></div>;
    case 'list': {
      const list = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      const set = (i: number, item: Record<string, unknown> | null) => onChange(item === null ? list.filter((_, j) => j !== i) : list.map((x, j) => (j === i ? item : x)));
      const move = (i: number, d: number) => { const n = [...list]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
      return (
        <div className="flex flex-col gap-2">{label}
          {list.map((item, i) => (
            <div key={i} className="rounded-xl border border-line p-3 flex flex-col gap-2 bg-canvas">
              <div className="flex justify-between text-xs font-bold text-sub"><span>#{i + 1}</span><span className="flex gap-3">
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button type="button" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button type="button" onClick={() => set(i, null)} className="text-danger-ink">Remove</button></span></div>
              {f.fields?.map(sf => <FieldEditor key={sf.name} f={sf} value={item[sf.name]} onChange={v => set(i, { ...item, [sf.name]: v })} />)}
            </div>
          ))}
          {list.length < (f.max ?? 20) && <div><Btn tone="ghost" onClick={() => onChange([...list, {}])}>Add {f.label.toLowerCase().replace(/s$/, '')}</Btn></div>}
        </div>
      );
    }
    default: return <label className="flex flex-col gap-1">{label}<input value={str} maxLength={f.max} onChange={e => onChange(e.target.value)} className={input} placeholder={f.kind === 'url' ? '/book or https://…' : undefined} /></label>;
  }
}

// ---------- page editor ----------
export function CmsPageEditor() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState<CmsPageFull | null>(null);
  const [revs, setRevs] = useState<Awaited<ReturnType<typeof cmsApi.page>>['revisions']>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [base, setBase] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const load = useCallback(() => { cmsApi.page(id).then(r => { setP(r.page); setRevs(r.revisions); setDirty(false); }).catch(e => setErr(msg(e))); }, [id]);
  useEffect(() => { load(); cmsApi.meta().then(m => setBase(m.siteUrl)).catch(() => undefined); }, [load]);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);
  if (!p) return <div><Header title="Page" /><Err e={err} /></div>;
  const up = (patch: Partial<CmsPageFull>) => { setP({ ...p, ...patch }); setDirty(true); setOk(null); };
  const setBlock = (i: number, b: CmsBlock | null) => up({ blocks: b === null ? p.blocks.filter((_, j) => j !== i) : p.blocks.map((x, j) => (j === i ? b : x)) });
  const move = (i: number, d: number) => { const n = [...p.blocks]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); up({ blocks: n }); };
  const body = () => ({ slug: p.slug, kind: p.kind, title: p.title, summary: p.summary || null, blocks: p.blocks, seo: { ...p.seo, imageFileId: p.seo.imageFileId || undefined }, sortOrder: p.sort_order, coverFileId: p.cover_file_id || null });
  const run = async (label: string, fn: () => Promise<unknown>) => { setErr(null); setOk(null); try { await fn(); setOk(label); load(); } catch (e) { setErr(msg(e)); } };
  const save = () => run('Draft saved.', () => cmsApi.save(id, body()));
  const publish = () => run('Published. It’s live on the website.', async () => { if (dirty) await cmsApi.save(id, body()); await cmsApi.publish(id); });
  const addBlock = (type: string) => { const b = { id: newId(), type }; up({ blocks: [...p.blocks, b] }); setOpen(b.id); };
  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <Header kicker={`${PAGE_KIND_LABEL[p.kind] ?? p.kind} · ${p.status}${dirty ? ' · unsaved changes' : ''}`} title={p.title || 'Untitled'} right={
        <div className="flex gap-2 flex-wrap">
          {base && <a href={`${base.replace(/\/$/, '')}/preview?path=${encodeURIComponent(p.slug)}`} target="_blank" rel="noreferrer" className="h-10 px-4 rounded-xl font-bold text-sm bg-white border border-line inline-flex items-center">Preview draft</a>}
          <Btn tone="ghost" disabled={!dirty} onClick={save}>Save draft</Btn>
          <Btn tone="brand" onClick={publish}>Publish</Btn>
        </div>} />
      {ok && <p className="text-sm font-semibold text-success-ink">{ok}</p>}
      <Err e={err} />
      <Card className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1"><span className="text-sm font-semibold text-sub">Title *</span><input value={p.title} onChange={e => up({ title: e.target.value })} className={input} /></label>
        <label className="flex flex-col gap-1"><span className="text-sm font-semibold text-sub">Web address</span>
          <span className="flex items-center gap-1"><span className="text-sub">/</span><input value={p.slug} disabled={p.slug === ''} onChange={e => up({ slug: e.target.value.toLowerCase() })} className={`${input} font-mono text-sm disabled:bg-canvas`} placeholder="home page" /></span></label>
        <label className="flex flex-col gap-1 md:col-span-2"><span className="text-sm font-semibold text-sub">Short summary (cards and lists)</span><textarea value={p.summary ?? ''} maxLength={500} rows={2} onChange={e => up({ summary: e.target.value })} className="rounded-xl border border-line p-3" /></label>
        <div className="flex flex-col gap-1"><span className="text-sm font-semibold text-sub">Cover image (cards, blog)</span><Upload kind="image" value={p.cover_file_id ?? ''} onChange={v => up({ cover_file_id: v || null })} /></div>
        <label className="flex flex-col gap-1 max-w-[160px]"><span className="text-sm font-semibold text-sub">Order in lists</span><input type="number" value={p.sort_order} onChange={e => up({ sort_order: Number(e.target.value) })} className={input} /></label>
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="font-extrabold">Search and sharing</p>
        <label className="flex flex-col gap-1"><span className="text-sm font-semibold text-sub">Search title ({(p.seo.title ?? '').length}/70)</span><input value={p.seo.title ?? ''} maxLength={70} onChange={e => up({ seo: { ...p.seo, title: e.target.value } })} className={input} placeholder={p.title} /></label>
        <label className="flex flex-col gap-1"><span className="text-sm font-semibold text-sub">Search description ({(p.seo.description ?? '').length}/170)</span><textarea value={p.seo.description ?? ''} maxLength={170} rows={2} onChange={e => up({ seo: { ...p.seo, description: e.target.value } })} className="rounded-xl border border-line p-3" /></label>
        <div className="flex flex-col gap-1"><span className="text-sm font-semibold text-sub">Image when shared on WhatsApp / Facebook</span><Upload kind="image" value={p.seo.imageFileId ?? ''} onChange={v => up({ seo: { ...p.seo, imageFileId: v } })} /></div>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={Boolean(p.seo.noindex)} onChange={e => up({ seo: { ...p.seo, noindex: e.target.checked } })} className="w-4 h-4" />Hide from Google</label>
        <div className="rounded-xl bg-canvas p-3 text-sm"><p className="text-brand font-semibold">{p.seo.title || p.title} | PhysioCare</p><p className="text-xs text-success-ink">{base ? siteUrl(base, p.slug) : `/${p.slug}`}</p><p className="text-sub">{p.seo.description || p.summary || 'Add a description so people know what this page is about.'}</p></div>
      </Card>
      <h2 className="text-xl font-extrabold">Sections</h2>
      {p.blocks.map((b, i) => {
        const def = BLOCK_TYPES[b.type];
        const isOpen = open === b.id;
        return (
          <Card key={b.id} className={`flex flex-col gap-3 ${isOpen ? 'border-brand' : ''}`}>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setOpen(isOpen ? null : b.id)} className="flex-1 text-left"><span className="font-extrabold">{i + 1}. {def?.label ?? b.type}</span> <span className="text-sub text-sm">{String(b.heading ?? b.title ?? b.body ?? '').slice(0, 60)}</span></button>
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="font-bold disabled:opacity-30" aria-label="Move up">↑</button>
              <button type="button" disabled={i === p.blocks.length - 1} onClick={() => move(i, 1)} className="font-bold disabled:opacity-30" aria-label="Move down">↓</button>
              <button type="button" onClick={() => up({ blocks: [...p.blocks.slice(0, i + 1), { ...structuredClone(b), id: newId() }, ...p.blocks.slice(i + 1)] })} className="text-sm font-bold text-sub">Copy</button>
              <button type="button" onClick={() => window.confirm('Remove this section?') && setBlock(i, null)} className="text-sm font-bold text-danger-ink">Remove</button>
            </div>
            {isOpen && def && <div className="flex flex-col gap-3 border-t border-line pt-3">{def.fields.map(f => <FieldEditor key={f.name} f={f} value={b[f.name]} onChange={v => setBlock(i, { ...b, [f.name]: v })} />)}</div>}
          </Card>
        );
      })}
      <Card className="flex flex-col gap-2">
        <p className="font-bold text-sm text-sub">Add a section</p>
        <div className="flex flex-wrap gap-2">{Object.entries(BLOCK_TYPES).map(([t, d]) => <Btn key={t} tone="ghost" onClick={() => addBlock(t)}>{d.label}</Btn>)}</div>
      </Card>
      <div className="flex gap-2 flex-wrap">
        {p.status === 'published' && p.slug !== '' && <Btn tone="ghost" onClick={() => window.confirm('Take this page off the website? It stays here as a draft.') && run('Taken offline.', () => cmsApi.unpublish(id))}>Take offline</Btn>}
        {p.slug !== '' && <Btn tone="danger" onClick={() => window.confirm('Archive this page? Only a super admin can do this.') && cmsApi.archive(id).then(() => nav('/website/pages')).catch(e => setErr(msg(e)))}>Archive</Btn>}
      </div>
      <Card className="flex flex-col gap-2">
        <p className="font-extrabold">Versions</p>
        {revs.map(r => (
          <div key={r.id} className="flex justify-between gap-3 text-sm border-t border-line pt-2 first:border-0 first:pt-0">
            <span>{when(r.created_at)} · <b>{r.action}</b> · {r.by_name ?? '—'}</span>
            <button type="button" className="text-brand font-bold" onClick={() => window.confirm('Load this version into the draft? Publish afterwards to make it live.') && run('Version restored into the draft.', () => cmsApi.restore(id, r.id))}>Restore</button>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ---------- site settings ----------
export function SiteSettingsPage() {
  const [s, setS] = useState<SiteSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => { cmsApi.site().then(r => setS(r.site)).catch(e => setErr(msg(e))); }, []);
  if (!s) return <div><Header title="Site settings" /><Err e={err} /></div>;
  const up = (patch: Partial<SiteSettings>) => { setS({ ...s, ...patch }); setOk(false); };
  const text = (k: keyof SiteSettings, label: string, ph?: string) => <label className="flex flex-col gap-1"><span className="text-sm font-semibold text-sub">{label}</span><input value={s[k] as string} placeholder={ph} onChange={e => up({ [k]: e.target.value } as Partial<SiteSettings>)} className={input} /></label>;
  const links = (list: { label: string; href: string }[], set: (l: { label: string; href: string }[]) => void, max: number) => (
    <div className="flex flex-col gap-2">
      {list.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <input value={l.label} placeholder="Label" onChange={e => set(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={input} />
          <input value={l.href} placeholder="/page" onChange={e => set(list.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))} className={`${input} font-mono text-sm`} />
          <button type="button" onClick={() => set(list.filter((_, j) => j !== i))} className="text-danger-ink font-bold px-2" aria-label="Remove link">×</button>
        </div>
      ))}
      {list.length < max && <div><Btn tone="ghost" onClick={() => set([...list, { label: '', href: '/' }])}>Add link</Btn></div>}
    </div>
  );
  async function save() { setErr(null); try { await cmsApi.saveSite(s!); setOk(true); } catch (e) { setErr(msg(e)); } }
  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <Header kicker="Website" title="Site settings" right={<Btn tone="brand" onClick={save}>Save</Btn>} />
      <p className="text-sm text-sub">Shown in the website header and footer. Starting values come from SITE_* in the server .env.</p>
      {ok && <p className="text-sm font-semibold text-success-ink">Saved. The website shows it within a minute.</p>}
      <Err e={err} />
      <Card className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {text('siteName', 'Site name')}{text('tagline', 'Tagline')}
        {text('supportPhone', 'Support phone', '+91 98765 43210')}{text('whatsapp', 'WhatsApp number', '9876543210')}
        {text('email', 'Support email', 'care@your-domain')}{text('hours', 'Support hours')}
        <div className="md:col-span-2">{text('address', 'Address')}</div>
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="font-extrabold">Announcement bar</p>
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={s.announcement.enabled} onChange={e => up({ announcement: { ...s.announcement, enabled: e.target.checked } })} className="w-4 h-4" />Show at the top of every page</label>
        <input value={s.announcement.text} placeholder="e.g. Now visiting Danapur and Phulwari Sharif" onChange={e => up({ announcement: { ...s.announcement, text: e.target.value } })} className={input} />
        <input value={s.announcement.href} placeholder="Link (optional), e.g. /patna" onChange={e => up({ announcement: { ...s.announcement, href: e.target.value } })} className={`${input} font-mono text-sm`} />
      </Card>
      <Card className="flex flex-col gap-3"><p className="font-extrabold">Header menu</p>{links(s.nav, nav => up({ nav }), 8)}</Card>
      <Card className="flex flex-col gap-4">
        <p className="font-extrabold">Footer columns</p>
        {s.footer.map((col, i) => (
          <div key={i} className="rounded-xl border border-line p-3 flex flex-col gap-2">
            <div className="flex gap-2"><input value={col.heading} onChange={e => up({ footer: s.footer.map((c, j) => (j === i ? { ...c, heading: e.target.value } : c)) })} className={`${input} font-bold`} />
              <button type="button" onClick={() => up({ footer: s.footer.filter((_, j) => j !== i) })} className="text-danger-ink font-bold px-2">Remove column</button></div>
            {links(col.links, l => up({ footer: s.footer.map((c, j) => (j === i ? { ...c, links: l } : c)) }), 10)}
          </div>
        ))}
        {s.footer.length < 5 && <div><Btn tone="ghost" onClick={() => up({ footer: [...s.footer, { heading: 'New column', links: [] }] })}>Add column</Btn></div>}
      </Card>
      <Card className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <p className="font-extrabold md:col-span-2">Social links</p>
        {(['facebook', 'instagram', 'youtube', 'linkedin'] as const).map(k => (
          <label key={k} className="flex flex-col gap-1"><span className="text-sm font-semibold text-sub capitalize">{k}</span><input value={s.social[k]} placeholder="https://…" onChange={e => up({ social: { ...s.social, [k]: e.target.value } })} className={input} /></label>
        ))}
      </Card>
    </div>
  );
}
