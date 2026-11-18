// Phase 6 · Website CMS. Public reads only see published content; editors work on drafts and publish.
import { Router } from 'express';
import { z } from 'zod';
import { BLOCK_TYPES, PAGE_KINDS, validateBlocks } from '@physioconnect/shared/cms';
import { config } from '../config/index.js';
import { sequelize } from '../db/index.js';
import { HttpError } from '../lib/util.js';
import { asyncHandler, requireAuth, requireRole, validate } from '../middleware/index.js';
import { audit } from '../services/audit.js';

const q = async (sql, replacements, transaction) => (await sequelize.query(sql, { replacements, transaction }))[0];
const one = async (sql, replacements, transaction) => (await q(sql, replacements, transaction))[0];
const site = async () => (await one(`SELECT value FROM app_settings WHERE key = 'site'`))?.value ?? config.defaults.site;
const cleanSlug = s => String(s ?? '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
const SLUG = /^$|^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const RESERVED = ['book', 'signin', 'about-you', 'payments', 'bookings', 'plans', 'visits', 'chat', 'rewards', 'partner', 'grievance', 'physios', 'api', 'r', 'preview'];

// ---------- public ----------
export const publicCmsRouter = Router();
publicCmsRouter.get('/site', asyncHandler(async (_req, res) => res.set('Cache-Control', 'public, max-age=60').json({ site: await site() })));
publicCmsRouter.get('/pages', asyncHandler(async (req, res) => {
  const kind = PAGE_KINDS.includes(String(req.query.kind)) ? String(req.query.kind) : null;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const pages = await q(`SELECT slug, kind, published_title AS title, published_summary AS summary, cover_file_id, published_at FROM cms_pages
    WHERE status = 'published' AND (:kind::text IS NULL OR kind = :kind) AND slug <> ''
    ORDER BY ${kind === 'blog' ? 'published_at DESC' : 'sort_order, published_title'} LIMIT :limit`, { kind, limit });
  res.set('Cache-Control', 'public, max-age=60').json({ pages });
}));
// The page at a URL path: /api/v1/public/page?path=/services/stroke-rehab ("" or "/" is the home page).
publicCmsRouter.get('/page', asyncHandler(async (req, res) => {
  const p = await one(`SELECT slug, kind, published_title AS title, published_summary AS summary, published_blocks AS blocks, published_seo AS seo, cover_file_id, published_at
    FROM cms_pages WHERE slug = :s AND status = 'published'`, { s: cleanSlug(req.query.path) });
  if (!p) throw new HttpError(404, 'not_found', 'Page not found.');
  res.set('Cache-Control', 'public, max-age=60').json({ page: p });
}));
// Verified physios for the website directory. No phone, address or exact location is ever shown.
const physioCols = `u.id, u.name, u.gender, tp.qualification, tp.years_experience, tp.bio, tp.specialisations, tp.languages, tp.tier, tp.rating::float AS rating,
  (SELECT count(*)::int FROM ratings r WHERE r.therapist_id = u.id) AS reviews,
  (SELECT count(*)::int FROM visits v WHERE v.therapist_id = u.id AND v.status = 'completed') AS sessions,
  (SELECT min(price_paise) FROM therapist_prices p WHERE p.therapist_id = u.id) AS from_paise`;
publicCmsRouter.get('/physios', asyncHandler(async (req, res) => {
  const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));
  const spec = String(req.query.speciality ?? '').trim();
  const physios = await q(`SELECT ${physioCols} FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id
    WHERE tp.verification_status = 'verified' AND tp.accepting AND u.status = 'active' AND (:spec = '' OR :spec = ANY(tp.specialisations))
    ORDER BY tp.rating DESC NULLS LAST, tp.years_experience DESC NULLS LAST LIMIT :limit`, { limit, spec });
  res.set('Cache-Control', 'public, max-age=120').json({ physios });
}));
publicCmsRouter.get('/physios/:id', asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new HttpError(404, 'not_found', 'Not found.');
  const p = await one(`SELECT ${physioCols} FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id
    WHERE u.id = :id AND tp.verification_status = 'verified' AND u.status = 'active'`, { id: req.params.id });
  if (!p) throw new HttpError(404, 'not_found', 'Physiotherapist not found.');
  const reviews = await q(`SELECT r.stars, r.tags, r.comment, r.created_at, split_part(u.name, ' ', 1) AS first_name FROM ratings r JOIN users u ON u.id = r.patient_id
    WHERE r.therapist_id = :id AND r.comment IS NOT NULL AND r.comment <> '' ORDER BY r.created_at DESC LIMIT 10`, { id: p.id });
  res.set('Cache-Control', 'public, max-age=120').json({ physio: p, reviews });
}));

// Search engines: sitemap and robots (served at the site root by the reverse proxy in production).
export const seoRouter = Router();
seoRouter.get('/sitemap.xml', asyncHandler(async (_req, res) => {
  const base = config.siteUrl.replace(/\/$/, '');
  const pages = await q(`SELECT slug, updated_at FROM cms_pages WHERE status = 'published' AND NOT COALESCE((published_seo->>'noindex')::boolean, false)`);
  const physios = await q(`SELECT u.id, tp.updated_at FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id WHERE tp.verification_status = 'verified' AND u.status = 'active'`);
  const urls = [...pages.map(p => [`/${p.slug}`, p.updated_at]), ['/physios', null], ...physios.map(p => [`/physios/${p.id}`, p.updated_at]), ['/grievance', null], ['/partner', null]];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d]) =>
    `  <url><loc>${base}${u === '/' ? '/' : u}</loc>${d ? `<lastmod>${new Date(d).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  res.set({ 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' }).send(xml);
}));
seoRouter.get('/robots.txt', (_req, res) => {
  const base = config.siteUrl.replace(/\/$/, '');
  res.type('text/plain').send(`User-agent: *\nDisallow: /book\nDisallow: /bookings\nDisallow: /payments\nDisallow: /chat\nDisallow: /preview\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
});

// ---------- console: editors ----------
export const adminCmsRouter = Router();
adminCmsRouter.use(requireAuth, requireRole('content_editor', 'ops_admin', 'super_admin'));
const pageBody = z.object({
  slug: z.string().transform(cleanSlug).refine(s => SLUG.test(s), 'Use lowercase letters, numbers and hyphens, with / between parts (e.g. services/stroke-rehab).')
    .refine(s => !RESERVED.includes(s.split('/')[0]), 'This address is used by the app. Pick another.'),
  kind: z.enum(PAGE_KINDS),
  title: z.string().trim().min(2).max(200),
  summary: z.string().trim().max(500).nullable().optional(),
  blocks: z.array(z.object({ id: z.string().min(1).max(40), type: z.string() }).passthrough()).max(60),
  seo: z.object({ title: z.string().trim().max(70).optional(), description: z.string().trim().max(170).optional(), imageFileId: z.string().uuid().optional().or(z.literal('')), noindex: z.boolean().optional() }).default({}),
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
  coverFileId: z.string().uuid().nullable().optional(),
});
const checkBlocks = blocks => { const e = validateBlocks(blocks); if (e) throw new HttpError(400, 'invalid_blocks', e); };
const revision = (pageId, p, action, userId, t) => q(`INSERT INTO cms_revisions (page_id, title, summary, blocks, seo, action, created_by) VALUES (:p, :t, :s, :b, :seo, :a, :u)`,
  { p: pageId, t: p.title, s: p.summary ?? null, b: JSON.stringify(p.blocks), seo: JSON.stringify(p.seo ?? {}), a: action, u: userId }, t);

adminCmsRouter.get('/meta', (_req, res) => res.json({ kinds: PAGE_KINDS, blocks: BLOCK_TYPES, siteUrl: config.siteUrl }));
adminCmsRouter.get('/pages', asyncHandler(async (req, res) => {
  const kind = PAGE_KINDS.includes(String(req.query.kind)) ? String(req.query.kind) : null;
  res.json({ pages: await q(`SELECT p.id, p.slug, p.kind, p.title, p.status, p.published_at, p.updated_at, p.sort_order, u.name AS updated_by_name,
      (p.status = 'published' AND (p.blocks <> p.published_blocks OR p.title <> p.published_title OR p.seo <> COALESCE(p.published_seo, '{}'))) AS unpublished_changes
    FROM cms_pages p LEFT JOIN users u ON u.id = p.updated_by WHERE (:kind::text IS NULL OR p.kind = :kind) ORDER BY p.kind, p.sort_order, p.title`, { kind }) });
}));
adminCmsRouter.get('/pages/:id', asyncHandler(async (req, res) => {
  const p = await one(`SELECT * FROM cms_pages WHERE id = :id`, { id: req.params.id });
  if (!p) throw new HttpError(404, 'not_found', 'Page not found.');
  const revisions = await q(`SELECT r.id, r.action, r.created_at, u.name AS by_name FROM cms_revisions r LEFT JOIN users u ON u.id = r.created_by WHERE r.page_id = :id ORDER BY r.id DESC LIMIT 50`, { id: p.id });
  res.json({ page: p, revisions: revisions.map(r => ({ ...r, id: Number(r.id) })) });
}));
adminCmsRouter.post('/pages', validate(pageBody), asyncHandler(async (req, res) => {
  const b = req.body; checkBlocks(b.blocks);
  try {
    const p = await sequelize.transaction(async t => {
      const row = await one(`INSERT INTO cms_pages (slug, kind, title, summary, blocks, seo, sort_order, cover_file_id, updated_by) VALUES (:slug, :kind, :title, :summary, :blocks, :seo, :sort, :cover, :u) RETURNING id`,
        { slug: b.slug, kind: b.kind, title: b.title, summary: b.summary ?? null, blocks: JSON.stringify(b.blocks), seo: JSON.stringify(b.seo), sort: b.sortOrder ?? 0, cover: b.coverFileId ?? null, u: req.user.id }, t);
      await revision(row.id, b, 'saved', req.user.id, t);
      return row;
    });
    await audit({ actor: req.user, action: 'cms.page_created', targetType: 'cms_page', targetId: p.id, after: { slug: b.slug, kind: b.kind }, ip: req.ip });
    res.status(201).json({ id: p.id });
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') throw new HttpError(409, 'slug_taken', 'Another page already uses this address.');
    throw e;
  }
}));
adminCmsRouter.put('/pages/:id', validate(pageBody), asyncHandler(async (req, res) => {
  const b = req.body; checkBlocks(b.blocks);
  try {
    await sequelize.transaction(async t => {
      const rows = await q(`UPDATE cms_pages SET slug = :slug, kind = :kind, title = :title, summary = :summary, blocks = :blocks, seo = :seo, sort_order = :sort, cover_file_id = :cover, updated_by = :u, updated_at = now() WHERE id = :id RETURNING id`,
        { slug: b.slug, kind: b.kind, title: b.title, summary: b.summary ?? null, blocks: JSON.stringify(b.blocks), seo: JSON.stringify(b.seo), sort: b.sortOrder ?? 0, cover: b.coverFileId ?? null, u: req.user.id, id: req.params.id }, t);
      if (!rows.length) throw new HttpError(404, 'not_found', 'Page not found.');
      await revision(req.params.id, b, 'saved', req.user.id, t);
    });
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') throw new HttpError(409, 'slug_taken', 'Another page already uses this address.');
    throw e;
  }
  res.json({ ok: true });
}));
adminCmsRouter.post('/pages/:id/publish', asyncHandler(async (req, res) => {
  const p = await one(`SELECT * FROM cms_pages WHERE id = :id`, { id: req.params.id });
  if (!p) throw new HttpError(404, 'not_found', 'Page not found.');
  checkBlocks(p.blocks);
  await sequelize.transaction(async t => {
    await q(`UPDATE cms_pages SET status = 'published', published_blocks = blocks, published_title = title, published_summary = summary, published_seo = seo, published_at = COALESCE(published_at, now()), updated_at = now() WHERE id = :id`, { id: p.id }, t);
    await revision(p.id, p, 'published', req.user.id, t);
  });
  await audit({ actor: req.user, action: 'cms.page_published', targetType: 'cms_page', targetId: p.id, after: { slug: p.slug }, ip: req.ip });
  res.json({ status: 'published' });
}));
adminCmsRouter.post('/pages/:id/unpublish', asyncHandler(async (req, res) => {
  const cur = await one(`SELECT slug FROM cms_pages WHERE id = :id`, { id: req.params.id });
  if (!cur) throw new HttpError(404, 'not_found', 'Page not found.');
  if (cur.slug === '') throw new HttpError(409, 'home_required', 'The home page can’t be taken offline. Edit it instead.');
  const p = await one(`UPDATE cms_pages SET status = 'draft', updated_at = now() WHERE id = :id RETURNING *`, { id: req.params.id });
  await revision(p.id, p, 'unpublished', req.user.id);
  await audit({ actor: req.user, action: 'cms.page_unpublished', targetType: 'cms_page', targetId: p.id, after: { slug: p.slug }, ip: req.ip });
  res.json({ status: 'draft' });
}));
adminCmsRouter.post('/pages/:id/restore/:rev', asyncHandler(async (req, res) => {
  const r = await one(`SELECT * FROM cms_revisions WHERE id = :rev AND page_id = :id`, { rev: req.params.rev, id: req.params.id });
  if (!r) throw new HttpError(404, 'not_found', 'Version not found.');
  await sequelize.transaction(async t => {
    await q(`UPDATE cms_pages SET title = :t, summary = :s, blocks = :b, seo = :seo, updated_by = :u, updated_at = now() WHERE id = :id`, { t: r.title, s: r.summary, b: JSON.stringify(r.blocks), seo: JSON.stringify(r.seo), u: req.user.id, id: req.params.id }, t);
    await revision(req.params.id, r, 'restored', req.user.id, t);
  });
  res.json({ ok: true });
}));
adminCmsRouter.delete('/pages/:id', requireRole('super_admin'), asyncHandler(async (req, res) => {
  const p = await one(`UPDATE cms_pages SET status = 'archived', updated_at = now() WHERE id = :id AND slug <> '' RETURNING slug`, { id: req.params.id });
  if (!p) throw new HttpError(404, 'not_found', 'Page not found (the home page can’t be archived).');
  await audit({ actor: req.user, action: 'cms.page_archived', targetType: 'cms_page', targetId: req.params.id, after: p, ip: req.ip });
  res.status(204).end();
}));
// Draft preview for editors (renders the same blocks the public page would).
adminCmsRouter.get('/preview', asyncHandler(async (req, res) => {
  const p = await one(`SELECT slug, kind, title, summary, blocks, seo, cover_file_id FROM cms_pages WHERE slug = :s`, { s: cleanSlug(req.query.path) });
  if (!p) throw new HttpError(404, 'not_found', 'Page not found.');
  res.json({ page: p });
}));

const link = z.object({ label: z.string().trim().min(1).max(60), href: z.string().trim().min(1).max(300) });
adminCmsRouter.get('/site', asyncHandler(async (_req, res) => res.json({ site: await site() })));
adminCmsRouter.put('/site', validate(z.object({
  siteName: z.string().trim().min(2).max(80), tagline: z.string().trim().max(160),
  supportPhone: z.string().trim().max(20), whatsapp: z.string().trim().max(20), email: z.string().trim().max(120).refine(v => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email.'),
  address: z.string().trim().max(300), hours: z.string().trim().max(120),
  announcement: z.object({ enabled: z.boolean(), text: z.string().trim().max(200), href: z.string().trim().max(300) }),
  nav: z.array(link).max(8),
  footer: z.array(z.object({ heading: z.string().trim().min(1).max(40), links: z.array(link).max(10) })).max(5),
  social: z.object({ facebook: z.string().max(300), instagram: z.string().max(300), youtube: z.string().max(300), linkedin: z.string().max(300) }),
})), asyncHandler(async (req, res) => {
  const before = await site();
  await q(`INSERT INTO app_settings (key, value, updated_by) VALUES ('site', :v, :u) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, { v: JSON.stringify(req.body), u: req.user.id });
  await audit({ actor: req.user, action: 'cms.site_updated', targetType: 'settings', targetId: 'site', before, after: req.body, ip: req.ip });
  res.json({ site: req.body });
}));
